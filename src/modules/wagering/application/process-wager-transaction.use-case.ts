import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { IdGenerator } from '../../../shared/application/id-generator';
import type {
  IntegrationEvent,
  IntegrationEventContext,
} from '../../../shared/domain/integration-event';
import { Money } from '../../../shared/domain/money';
import { MetricsService } from '../../../shared/infrastructure/metrics.service';
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
import { WagerTransactionPendingReferenceEvent } from '../domain/events/wager-transaction-pending-reference.event';
import { WagerTransactionProcessedEvent } from '../domain/events/wager-transaction-processed.event';
import { WagerTransactionRejectedEvent } from '../domain/events/wager-transaction-rejected.event';
import { WagerTransactionRepository } from './ports/wager-transaction.repository';

// Todos os kinds da seção 6.3 já têm efeito implementado. REFUND/ROLLBACK
// (Parte 7) resolvem referência antes de aplicar efeito — ver applyReversal.
const SUPPORTED_KINDS: ReadonlySet<WagerTransactionKind> = new Set([
  WagerTransactionKind.Bet,
  WagerTransactionKind.Win,
  WagerTransactionKind.Loss,
  WagerTransactionKind.Opening,
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
]);

// REFUND só reverte um BET; ROLLBACK reverte BET, WIN ou REFUND (regra 3, seção 7).
const ALLOWED_REFERENCE_KINDS: Record<WagerTransactionKind, ReadonlySet<WagerTransactionKind>> = {
  [WagerTransactionKind.Refund]: new Set([WagerTransactionKind.Bet]),
  [WagerTransactionKind.Rollback]: new Set([
    WagerTransactionKind.Bet,
    WagerTransactionKind.Win,
    WagerTransactionKind.Refund,
  ]),
  [WagerTransactionKind.Bet]: new Set(),
  [WagerTransactionKind.Win]: new Set(),
  [WagerTransactionKind.Loss]: new Set(),
  [WagerTransactionKind.Opening]: new Set(),
};

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
  private readonly logger = new Logger(ProcessWagerTransactionUseCase.name);

  constructor(
    private readonly em: EntityManager,
    private readonly walletRepository: WalletRepository,
    private readonly walletLedgerEntryRepository: WalletLedgerEntryRepository,
    private readonly wagerTransactionRepository: WagerTransactionRepository,
    private readonly outboxMessageRepository: OutboxMessageRepository,
    private readonly idGenerator: IdGenerator,
    private readonly metrics: MetricsService,
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
    const stopProcessingTimer = this.metrics.wagerTransactionProcessingSeconds.startTimer();
    try {
      if (!SUPPORTED_KINDS.has(command.kind)) {
        throw new UnsupportedWagerKindError(command.kind);
      }

      // SELECT ... FOR UPDATE — trava a linha da wallet até o fim desta
      // transação. Qualquer outra requisição concorrente pra MESMA
      // wallet bloqueia aqui, entra depois que esta commitar, e enxerga
      // o saldo já atualizado.
      const wallet = await this.lockWallet(command.walletId, em);

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
        return await this.toReplayResult(existing, em);
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

      const ledgerEntry = await this.applyEffect(transaction, wallet, money, em);

      await this.persistOutcome(
        transaction,
        wallet,
        ledgerEntry,
        command.correlationId,
        command.causationId,
        em,
      );

      return this.toResult(transaction, wallet, false);
    } finally {
      stopProcessingTimer();
    }
  }

  /**
   * `SELECT ... FOR UPDATE` na linha da wallet, com o tempo de espera
   * registrado em `walletLockWaitSeconds` (seção 12: "disputas de lock")
   * — sinal direto de contenção numa hot wallet sob concorrência real.
   */
  private async lockWallet(walletId: string, em: EntityManager): Promise<Wallet> {
    const stopLockTimer = this.metrics.walletLockWaitSeconds.startTimer();
    try {
      const wallet = await this.walletRepository.findByIdForUpdate(walletId, em);
      if (!wallet) {
        throw new WalletNotFoundError(walletId);
      }
      return wallet;
    } finally {
      stopLockTimer();
    }
  }

  /**
   * Reprocessa uma transação já em `PendingReference` (worker da seção
   * 7.1) — a referência pode ter aparecido nesse meio tempo. Refaz a
   * leitura da transação sob a wallet travada: se outra instância/ciclo já
   * resolveu essa mesma transação entretanto, vira um no-op silencioso em
   * vez de um erro de transição de estado inválida.
   */
  async retryPendingReference(transactionId: string, em: EntityManager): Promise<void> {
    const current = await this.wagerTransactionRepository.findById(transactionId, em);
    if (!current || current.status !== WagerTransactionStatus.PendingReference) {
      return;
    }

    const wallet = await this.lockWallet(current.walletId, em);

    const ledgerEntry = await this.applyReversal(current, wallet, em);
    await this.persistOutcome(current, wallet, ledgerEntry, undefined, undefined, em);
  }

  /**
   * Esgotado o TTL de espera pela referência (seção 7.1) — rejeita
   * explicitamente em vez de deixar a transação pendurada pra sempre.
   * Mesma proteção contra corrida que `retryPendingReference`.
   */
  async expirePendingReference(transactionId: string, em: EntityManager): Promise<void> {
    const current = await this.wagerTransactionRepository.findById(transactionId, em);
    if (!current || current.status !== WagerTransactionStatus.PendingReference) {
      return;
    }

    const wallet = await this.walletRepository.findById(current.walletId, em);
    if (!wallet) {
      throw new WalletNotFoundError(current.walletId);
    }

    current.markRejected('REFERENCE_NOT_FOUND');
    await this.persistOutcome(current, wallet, undefined, undefined, undefined, em);
  }

  private async persistOutcome(
    transaction: WagerTransaction,
    wallet: Wallet,
    ledgerEntry: WalletLedgerEntry | undefined,
    correlationId: string | undefined,
    causationId: string | undefined,
    em: EntityManager,
  ): Promise<void> {
    await this.walletRepository.save(wallet, em);
    if (ledgerEntry) {
      await this.walletLedgerEntryRepository.save(ledgerEntry, em);
    }
    await this.wagerTransactionRepository.save(transaction, em);

    const ctx: IntegrationEventContext = {
      correlationId: correlationId ?? this.idGenerator.next(),
      causationId,
    };
    await this.enqueueEvents(transaction, wallet, ledgerEntry, ctx, em);

    // Seção 12: transações por status (métrica) + log estruturado com os
    // identificadores mínimos exigidos — nunca o valor monetário nem
    // payload bruto, só o necessário pra correlacionar/investigar.
    this.metrics.wagerTransactionsTotal.inc({ status: transaction.status, kind: transaction.kind });
    this.logger.log({
      event: 'wager_transaction_finalized',
      transactionId: transaction.id,
      walletId: transaction.walletId,
      providerId: transaction.providerId,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      status: transaction.status,
      kind: transaction.kind,
      failureCode: transaction.failureCode,
    });

    // Flush explícito — agregados se referenciam só por FK escalar (sem
    // relação do MikroORM), então se este método for composto com outro
    // use case na mesma transação (ex: consumer SQS: inbox + este use
    // case), o próximo insert dependente precisa encontrar estas linhas
    // já na base, não só no unit of work em memória. Achado testando o
    // endpoint de verdade (Parte 6), não em unit test.
    await em.flush();
  }

  private toResult(
    transaction: WagerTransaction,
    wallet: Wallet,
    idempotentReplay: boolean,
  ): ProcessWagerTransactionResult {
    return {
      transactionId: transaction.id,
      status: transaction.status,
      balance: {
        amount: wallet.currentBalance.toString(),
        currency: wallet.currentBalance.currencyCode,
      },
      idempotentReplay,
      failureCode: transaction.failureCode,
    };
  }

  /**
   * Aplica o efeito de negócio no saldo (regras da seção 7) e transiciona
   * a transação pro status final. Devolve o lançamento de ledger quando
   * há impacto financeiro — `undefined` pra LOSS, rejeição, e
   * PendingReference (regra 6: "REJECTED não altera saldo nem gera ledger").
   */
  private async applyEffect(
    transaction: WagerTransaction,
    wallet: Wallet,
    money: Money,
    em: EntityManager,
  ): Promise<WalletLedgerEntry | undefined> {
    switch (transaction.kind) {
      case WagerTransactionKind.Bet:
        try {
          return this.debit(transaction, wallet, money);
        } catch (error) {
          if (error instanceof InsufficientBalanceError) {
            transaction.markRejected('INSUFFICIENT_BALANCE');
            return undefined;
          }
          throw error;
        }

      case WagerTransactionKind.Win:
      case WagerTransactionKind.Opening:
        return this.credit(transaction, wallet, money);

      case WagerTransactionKind.Loss:
        transaction.markProcessed();
        return undefined;

      case WagerTransactionKind.Refund:
      case WagerTransactionKind.Rollback:
        return this.applyReversal(transaction, wallet, em);

      default:
        // SUPPORTED_KINDS já barra qualquer coisa fora daqui.
        throw new UnsupportedWagerKindError(transaction.kind);
    }
  }

  /**
   * Resolve `(providerId, referenceExternalTransactionId)` e aplica o
   * inverso do que a transação referenciada fez (regras 1-5 e 9, seção
   * 7). Referência ausente vira `PendingReference`, não erro — o worker
   * (seção 7.1) tenta de novo depois.
   */
  private async applyReversal(
    transaction: WagerTransaction,
    wallet: Wallet,
    em: EntityManager,
  ): Promise<WalletLedgerEntry | undefined> {
    const referenceExternalTransactionId = transaction.referenceExternalTransactionId;
    if (!referenceExternalTransactionId) {
      // WagerTransaction.create() já exige isso pra Refund/Rollback —
      // defensivo, não deveria ser alcançável.
      transaction.markRejected('REFERENCE_NOT_FOUND');
      return undefined;
    }

    const referenced = await this.wagerTransactionRepository.findByProviderAndExternalId(
      transaction.providerId,
      referenceExternalTransactionId,
      em,
    );

    if (!referenced) {
      transaction.markPendingReference();
      return undefined;
    }

    // Regra 2: mesmo provider (já garantido pela busca), player, wallet, moeda, rodada.
    if (
      referenced.playerId !== transaction.playerId ||
      referenced.walletId !== transaction.walletId ||
      referenced.roundId !== transaction.roundId ||
      referenced.money.currencyCode !== transaction.money.currencyCode
    ) {
      transaction.markRejected('REFERENCE_OUT_OF_SCOPE');
      return undefined;
    }

    // Só transação já PROCESSADA pode ser revertida.
    if (referenced.status !== WagerTransactionStatus.Processed) {
      transaction.markRejected('REFERENCE_NOT_PROCESSED');
      return undefined;
    }

    // Regra 3: REFUND só referencia BET; ROLLBACK referencia BET/WIN/REFUND.
    if (!ALLOWED_REFERENCE_KINDS[transaction.kind].has(referenced.kind)) {
      transaction.markRejected('REFERENCE_KIND_NOT_ALLOWED');
      return undefined;
    }

    // Regra 5: valor idêntico ao da referência — reversão parcial fora de escopo.
    if (!transaction.money.equals(referenced.money)) {
      transaction.markRejected('REFERENCE_AMOUNT_MISMATCH');
      return undefined;
    }

    // Regra 4: a mesma referência não pode ser revertida duas vezes pelo
    // MESMO tipo de operação (um REFUND e um ROLLBACK sobre o mesmo BET
    // são coisas distintas, cada um vale uma vez).
    const alreadyReversed = await this.wagerTransactionRepository.existsProcessedReversal(
      referenced.id,
      transaction.kind,
      em,
    );
    if (alreadyReversed) {
      transaction.markRejected('REFERENCE_ALREADY_REVERSED');
      return undefined;
    }

    transaction.resolveReference(referenced.id);

    // BET foi débito -> reverter credita. WIN/REFUND foram crédito -> reverter debita.
    const isCreditReversal = referenced.kind === WagerTransactionKind.Bet;

    try {
      return isCreditReversal
        ? this.credit(transaction, wallet, transaction.money)
        : this.debit(transaction, wallet, transaction.money);
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        // Regra 9: código DISTINTO do de aposta sem saldo — mesma "falta
        // de saldo" na superfície, situação operacionalmente diferente.
        transaction.markRejected('REVERSAL_WOULD_OVERDRAW');
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
   * Enfileira os eventos mínimos exigidos (seção 11): Processed/Rejected/
   * PendingReference conforme o status final; WalletBalanceChanged só
   * quando o lançamento existe (só quando o saldo mudou de fato).
   */
  private async enqueueEvents(
    transaction: WagerTransaction,
    wallet: Wallet,
    ledgerEntry: WalletLedgerEntry | undefined,
    ctx: IntegrationEventContext,
    em: EntityManager,
  ): Promise<void> {
    const events: IntegrationEvent<unknown>[] = [];

    switch (transaction.status) {
      case WagerTransactionStatus.Processed:
        events.push(
          WagerTransactionProcessedEvent.from({
            eventId: this.idGenerator.next(),
            transaction,
            ctx,
          }),
        );
        break;
      case WagerTransactionStatus.Rejected:
        events.push(
          WagerTransactionRejectedEvent.from({
            eventId: this.idGenerator.next(),
            transaction,
            ctx,
          }),
        );
        break;
      case WagerTransactionStatus.PendingReference:
        events.push(
          WagerTransactionPendingReferenceEvent.from({
            eventId: this.idGenerator.next(),
            transaction,
            ctx,
          }),
        );
        break;
      default:
        break;
    }

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
   * saldo histórico sem recomputar nada. Sem lançamento (LOSS, rejeição,
   * PendingReference) não há mudança de saldo, então o saldo atual da
   * wallet já é o valor correto — simplificação documentada (não existe
   * campo de snapshot de saldo na WagerTransaction em si).
   *
   * Replay não reenfileira evento nenhum — o outbox já tem o que precisa
   * da vez em que a transação foi processada de verdade.
   */
  private async toReplayResult(
    transaction: WagerTransaction,
    em: EntityManager,
  ): Promise<ProcessWagerTransactionResult> {
    // Regra 7 (seção 7) na prática: mesma idempotencyKey vista de novo.
    // Seção 12 pede "duplicatas identificadas" como métrica explícita.
    this.metrics.wagerTransactionDuplicatesTotal.inc();

    const entry =
      transaction.status === WagerTransactionStatus.Processed
        ? await this.walletLedgerEntryRepository.findByTransactionId(transaction.id, em)
        : null;

    const wallet = await this.walletRepository.findById(transaction.walletId, em);
    if (!wallet) {
      throw new WalletNotFoundError(transaction.walletId);
    }

    if (entry) {
      // Espelha o saldo histórico do ledger na resposta sem alterar o
      // objeto wallet de verdade — via reconstitute em cima do mesmo id.
      const historical = Wallet.rehydrate({
        id: wallet.id,
        playerId: wallet.playerId,
        balance: entry.balanceAfter,
        version: wallet.currentVersion,
      });
      return this.toResult(transaction, historical, true);
    }

    return this.toResult(transaction, wallet, true);
  }
}
