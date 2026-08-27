import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { IdGenerator } from '../../../shared/application/id-generator';
import type {
  IntegrationEvent,
  IntegrationEventContext,
} from '../../../shared/domain/integration-event';
import { Money } from '../../../shared/domain/money';
import { OutboxMessageRepository } from '../../messaging/application/ports/outbox-message.repository';
import { OutboxMessage } from '../../messaging/domain/outbox-message';
import { WalletBalanceChangedEvent } from '../../wallet/domain/events/wallet-balance-changed.event';
import { WalletLedgerEntryRepository } from '../../wallet/application/ports/wallet-ledger-entry.repository';
import { WalletRepository } from '../../wallet/application/ports/wallet.repository';
import { Wallet } from '../../wallet/domain/wallet';
import { LedgerDirection, WalletLedgerEntry } from '../../wallet/domain/wallet-ledger-entry';
import { InsufficientBalanceError, WalletNotFoundError } from '../../wallet/domain/wallet.errors';
import {
  type FailureCode,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../domain/wager-transaction';
import { UnsupportedWagerKindError } from '../domain/wagering.errors';
import { WagerTransactionProcessedEvent } from '../domain/events/wager-transaction-processed.event';
import { WagerTransactionRejectedEvent } from '../domain/events/wager-transaction-rejected.event';
import { WagerTransactionRepository } from './ports/wager-transaction.repository';

// BET/WIN/LOSS/OPENING têm efeito direto no saldo, sem depender de
// resolver referência pra outra transação. REFUND/ROLLBACK exigem essa
// resolução (regras 1-5 da seção 7) — chegam na Parte 7.
const SUPPORTED_KINDS: ReadonlySet<WagerTransactionKind> = new Set([
  WagerTransactionKind.Bet,
  WagerTransactionKind.Win,
  WagerTransactionKind.Loss,
  WagerTransactionKind.Opening,
]);

export interface ProcessWagerTransactionCommand {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  amount: string;
  currency: string;
  referenceExternalTransactionId?: string;
  /** Amarra os eventos gerados a essa requisição. Gerado se ausente. */
  correlationId?: string;
  /** Id do evento/mensagem que causou esta chamada (ex: SQS messageId). */
  causationId?: string;
}

export interface ProcessWagerTransactionResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: { amount: string; currency: string };
  idempotentReplay: boolean;
  failureCode?: FailureCode;
}

/**
 * Caso de uso central do desafio — processa uma `WagerTransaction` de
 * ponta a ponta: idempotência, lock, efeito no saldo, ledger, eventos de
 * integração (via outbox), tudo numa única transação SQL.
 *
 * Estratégia de concorrência: **pessimistic locking** via
 * `SELECT ... FOR UPDATE` na linha da wallet (seção 8 deixa a escolha
 * livre, contanto que seja justificada). Escolhida em vez de optimistic
 * locking com retry porque: (1) processar apostas contra UMA wallet é
 * inerentemente sequencial — não existe ganho real em permitir que duas
 * apostas do mesmo jogador avancem "em paralelo" só pra uma delas ter que
 * refazer o trabalho depois; (2) o lock do Postgres funciona igual não
 * importa quantas instâncias da aplicação existem (é a garantia real por
 * trás do requisito de 3+ instâncias), sem precisar de nenhum estado
 * compartilhado em memória; (3) a janela do lock é curta (uma
 * transação só faz leitura+escrita local, sem I/O externo no meio), então
 * o risco de contenção numa "hot wallet" é baixo na prática.
 *
 * Eventos: enfileirados no outbox **na mesma transação** que persiste a
 * mudança — nunca publicados diretamente pro SQS aqui (isso é trabalho do
 * `OutboxPublisherWorker`, depois do commit). É assim que "publicar só
 * depois do commit" é garantido sem transação distribuída.
 */
@Injectable()
export class ProcessWagerTransactionUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly walletRepository: WalletRepository,
    private readonly walletLedgerEntryRepository: WalletLedgerEntryRepository,
    private readonly wagerTransactionRepository: WagerTransactionRepository,
    private readonly outboxMessageRepository: OutboxMessageRepository,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: ProcessWagerTransactionCommand): Promise<ProcessWagerTransactionResult> {
    return this.em.transactional((em) => this.processWithinTransaction(command, em));
  }

  /**
   * Mesma lógica de `execute()`, mas dentro de uma transação que o
   * chamador já abriu — usado pelo consumidor SQS (Parte 5), que precisa
   * que a escrita do inbox e o processamento da transação sejam a MESMA
   * transação SQL (seção 6.5: "inbox, alteração financeira de wallet,
   * ledger e outbox participam da mesma transação SQL"). Deliberadamente
   * não depende de detecção implícita de transação aninhada do MikroORM
   * — o chamador é explícito sobre em qual `em` está rodando.
   */
  async processWithinTransaction(
    command: ProcessWagerTransactionCommand,
    em: EntityManager,
  ): Promise<ProcessWagerTransactionResult> {
    if (!SUPPORTED_KINDS.has(command.kind)) {
      throw new UnsupportedWagerKindError(command.kind);
    }

    // SELECT ... FOR UPDATE — trava a linha da wallet até o fim desta
    // transação. Qualquer outra requisição concorrente pra MESMA
    // wallet bloqueia aqui, entra depois que esta commitar, e enxerga
    // o saldo já atualizado.
    const wallet = await this.walletRepository.findByIdForUpdate(command.walletId, em);
    if (!wallet) {
      throw new WalletNotFoundError(command.walletId);
    }

    // Regra 7 (seção 7): replay de uma idempotencyKey já processada
    // retorna o resultado original, sem reprocessar nada. Checado
    // DEPOIS do lock, de propósito: duas requisições com a MESMA
    // idempotencyKey pra mesma wallet disparadas juntas passariam as
    // duas por um "não existe" se checássemos antes de travar — a
    // segunda só chegaria aqui depois que a primeira já commitou, e
    // tentaria inserir a idempotencyKey de novo, batendo de frente no
    // UNIQUE constraint como erro cru em vez de replay limpo. Sob o
    // lock da wallet, isso é estruturalmente impossível.
    const existing = await this.wagerTransactionRepository.findByIdempotencyKey(
      command.idempotencyKey,
      em,
    );
    if (existing) {
      return this.toReplayResult(existing, em);
    }

    const money = Money.fromString(command.amount, command.currency);

    const transaction = WagerTransaction.create({
      id: this.idGenerator.next(),
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      idempotencyKey: command.idempotencyKey,
      payloadHash: command.payloadHash,
      walletId: wallet.id,
      playerId: command.playerId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money,
      referenceExternalTransactionId: command.referenceExternalTransactionId,
    });

    const ledgerEntry = this.applyEffect(transaction, wallet, money);

    await this.walletRepository.save(wallet, em);
    if (ledgerEntry) {
      await this.walletLedgerEntryRepository.save(ledgerEntry, em);
    }
    await this.wagerTransactionRepository.save(transaction, em);

    const ctx: IntegrationEventContext = {
      correlationId: command.correlationId ?? this.idGenerator.next(),
      causationId: command.causationId,
    };
    await this.enqueueEvents(transaction, wallet, ledgerEntry, ctx, em);

    return {
      transactionId: transaction.id,
      status: transaction.status,
      balance: {
        amount: wallet.currentBalance.toString(),
        currency: wallet.currentBalance.currencyCode,
      },
      idempotentReplay: false,
      failureCode: transaction.failureCode,
    };
  }

  /**
   * Aplica o efeito de negócio no saldo (regras da seção 7) e transiciona
   * a transação pro status final. Devolve o lançamento de ledger quando
   * há impacto financeiro — `undefined` pra LOSS e pra rejeição (regra 6:
   * "REJECTED não altera saldo nem gera ledger").
   */
  private applyEffect(
    transaction: WagerTransaction,
    wallet: Wallet,
    money: Money,
  ): WalletLedgerEntry | undefined {
    try {
      switch (transaction.kind) {
        case WagerTransactionKind.Bet:
          return this.debit(transaction, wallet, money);

        case WagerTransactionKind.Win:
        case WagerTransactionKind.Opening:
          return this.credit(transaction, wallet, money);

        case WagerTransactionKind.Loss:
          transaction.markProcessed();
          return undefined;

        default:
          // SUPPORTED_KINDS já barrou REFUND/ROLLBACK antes de chegar aqui.
          throw new UnsupportedWagerKindError(transaction.kind);
      }
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        transaction.markRejected('INSUFFICIENT_BALANCE');
        return undefined;
      }
      throw error;
    }
  }

  private debit(transaction: WagerTransaction, wallet: Wallet, money: Money): WalletLedgerEntry {
    const balanceBefore = wallet.currentBalance;
    wallet.debit(money); // lança InsufficientBalanceError se saldo não cobrir
    transaction.markProcessed();

    return WalletLedgerEntry.create({
      id: this.idGenerator.next(),
      walletId: wallet.id,
      transactionId: transaction.id,
      direction: LedgerDirection.Debit,
      money,
      balanceBefore,
    });
  }

  private credit(transaction: WagerTransaction, wallet: Wallet, money: Money): WalletLedgerEntry {
    const balanceBefore = wallet.currentBalance;
    wallet.credit(money);
    transaction.markProcessed();

    return WalletLedgerEntry.create({
      id: this.idGenerator.next(),
      walletId: wallet.id,
      transactionId: transaction.id,
      direction: LedgerDirection.Credit,
      money,
      balanceBefore,
    });
  }

  /**
   * Enfileira os eventos mínimos exigidos (seção 11): Processed/Rejected
   * sempre; WalletBalanceChanged só quando o lançamento existe (ou seja,
   * só quando o saldo mudou de fato — nunca pra LOSS/rejeição).
   */
  private async enqueueEvents(
    transaction: WagerTransaction,
    wallet: Wallet,
    ledgerEntry: WalletLedgerEntry | undefined,
    ctx: IntegrationEventContext,
    em: EntityManager,
  ): Promise<void> {
    const events: IntegrationEvent<unknown>[] =
      transaction.status === WagerTransactionStatus.Processed
        ? [
            WagerTransactionProcessedEvent.from({
              eventId: this.idGenerator.next(),
              transaction,
              ctx,
            }),
          ]
        : [
            WagerTransactionRejectedEvent.from({
              eventId: this.idGenerator.next(),
              transaction,
              ctx,
            }),
          ];

    if (ledgerEntry) {
      events.push(
        WalletBalanceChangedEvent.from({
          eventId: this.idGenerator.next(),
          wallet,
          entry: ledgerEntry,
          ctx,
        }),
      );
    }

    for (const event of events) {
      await this.outboxMessageRepository.save(
        OutboxMessage.enqueue({ id: this.idGenerator.next(), event }),
        em,
      );
    }
  }

  /**
   * Saldo "observado naquele momento" (regra 7): pra transação
   * PROCESSED com lançamento, é o `balanceAfter` do próprio ledger — a
   * razão de existir de um ledger imutável é justamente poder reconstruir
   * saldo histórico sem recomputar nada. Pra REJECTED (ou PROCESSED sem
   * lançamento, caso de LOSS) não há mudança de saldo, então o saldo
   * atual da wallet já é o valor correto — simplificação documentada
   * (não existe campo de snapshot de saldo na WagerTransaction em si).
   *
   * Replay não reenfileira evento nenhum — o outbox já tem o que precisa
   * da vez em que a transação foi processada de verdade.
   */
  private async toReplayResult(
    transaction: WagerTransaction,
    em: EntityManager,
  ): Promise<ProcessWagerTransactionResult> {
    const entry =
      transaction.status === WagerTransactionStatus.Processed
        ? await this.walletLedgerEntryRepository.findByTransactionId(transaction.id, em)
        : null;

    let balance: Money;
    if (entry) {
      balance = entry.balanceAfter;
    } else {
      const wallet = await this.walletRepository.findById(transaction.walletId, em);
      if (!wallet) {
        throw new WalletNotFoundError(transaction.walletId);
      }
      balance = wallet.currentBalance;
    }

    return {
      transactionId: transaction.id,
      status: transaction.status,
      balance: { amount: balance.toString(), currency: balance.currencyCode },
      idempotentReplay: true,
      failureCode: transaction.failureCode,
    };
  }
}
