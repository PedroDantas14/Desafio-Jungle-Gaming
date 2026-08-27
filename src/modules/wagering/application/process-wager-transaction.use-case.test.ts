import { describe, expect, it } from 'bun:test';
import type { EntityManager } from '@mikro-orm/postgresql';
import { type IdGenerator } from '../../../shared/application/id-generator';
import { Money } from '../../../shared/domain/money';
import { type OutboxMessageRepository } from '../../messaging/application/ports/outbox-message.repository';
import { type OutboxMessage } from '../../messaging/domain/outbox-message';
import { type WalletLedgerEntryRepository } from '../../wallet/application/ports/wallet-ledger-entry.repository';
import { type WalletRepository } from '../../wallet/application/ports/wallet.repository';
import { Wallet } from '../../wallet/domain/wallet';
import { LedgerDirection, type WalletLedgerEntry } from '../../wallet/domain/wallet-ledger-entry';
import {
  type WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../domain/wager-transaction';
import { UnsupportedWagerKindError } from '../domain/wagering.errors';
import { type WagerTransactionRepository } from './ports/wager-transaction.repository';
import {
  type ProcessWagerTransactionCommand,
  ProcessWagerTransactionUseCase,
} from './process-wager-transaction.use-case';

// Stub mínimo de EntityManager — só precisa satisfazer `em.transactional(cb)`
// chamando `cb` direto, sem transação SQL de verdade nenhuma.
class FakeEntityManager {
  async transactional<T>(cb: (em: unknown) => Promise<T>): Promise<T> {
    return cb(this);
  }
}

class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  next(): string {
    this.counter += 1;
    return `id-${this.counter}`;
  }
}

class FakeWalletRepository implements WalletRepository {
  private readonly byId = new Map<string, Wallet>();

  seed(wallet: Wallet): void {
    this.byId.set(wallet.id, wallet);
  }

  async findById(id: string): Promise<Wallet | null> {
    return this.byId.get(id) ?? null;
  }

  async findByIdForUpdate(id: string): Promise<Wallet | null> {
    // Fake não trava nada de verdade — ver nota no describe() sobre o
    // que esse arquivo prova e o que não prova.
    return this.byId.get(id) ?? null;
  }

  async findByPlayerAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    for (const wallet of this.byId.values()) {
      if (wallet.playerId === playerId && wallet.currency === currency) {
        return wallet;
      }
    }
    return null;
  }

  async save(wallet: Wallet): Promise<void> {
    this.byId.set(wallet.id, wallet);
  }
}

class FakeWalletLedgerEntryRepository implements WalletLedgerEntryRepository {
  readonly entries: WalletLedgerEntry[] = [];

  async save(entry: WalletLedgerEntry): Promise<void> {
    this.entries.push(entry);
  }

  async findByTransactionId(transactionId: string): Promise<WalletLedgerEntry | null> {
    return this.entries.find((entry) => entry.transactionId === transactionId) ?? null;
  }
}

class FakeWagerTransactionRepository implements WagerTransactionRepository {
  private readonly byId = new Map<string, WagerTransaction>();
  private readonly idByIdempotencyKey = new Map<string, string>();

  async findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null> {
    const id = this.idByIdempotencyKey.get(idempotencyKey);
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    for (const tx of this.byId.values()) {
      if (tx.providerId === providerId && tx.externalTransactionId === externalTransactionId) {
        return tx;
      }
    }
    return null;
  }

  async save(transaction: WagerTransaction): Promise<void> {
    this.byId.set(transaction.id, transaction);
    this.idByIdempotencyKey.set(transaction.idempotencyKey, transaction.id);
  }
}

class FakeOutboxMessageRepository implements OutboxMessageRepository {
  readonly messages: OutboxMessage[] = [];

  async claimDue(): Promise<OutboxMessage[]> {
    return this.messages.filter((m) => !m.isPublished);
  }

  async save(message: OutboxMessage): Promise<void> {
    this.messages.push(message);
  }
}

function setup() {
  const walletRepository = new FakeWalletRepository();
  const walletLedgerEntryRepository = new FakeWalletLedgerEntryRepository();
  const wagerTransactionRepository = new FakeWagerTransactionRepository();
  const outboxMessageRepository = new FakeOutboxMessageRepository();
  const idGenerator = new SequentialIdGenerator();

  const useCase = new ProcessWagerTransactionUseCase(
    new FakeEntityManager() as unknown as EntityManager,
    walletRepository,
    walletLedgerEntryRepository,
    wagerTransactionRepository,
    outboxMessageRepository,
    idGenerator,
  );

  return {
    useCase,
    walletRepository,
    walletLedgerEntryRepository,
    wagerTransactionRepository,
    outboxMessageRepository,
  };
}

function betCommand(
  overrides: Partial<ProcessWagerTransactionCommand> = {},
): ProcessWagerTransactionCommand {
  return {
    providerId: 'provider-a',
    externalTransactionId: 'transaction-1',
    idempotencyKey: 'provider-a:transaction-1',
    payloadHash: 'hash-1',
    walletId: 'w1',
    playerId: 'p1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    amount: '80.00',
    currency: 'BRL',
    ...overrides,
  };
}

/**
 * Este arquivo prova a LÓGICA DE DECISÃO do use case (débito/crédito
 * correto por kind, rejeição sem saldo, idempotência, kind não suportado)
 * de forma isolada e rápida, sem banco.
 *
 * O que ele NÃO prova: que o lock (`SELECT ... FOR UPDATE`) realmente
 * impede lost update sob concorrência de verdade. O fake não trava nada —
 * duas chamadas concorrentes aqui só dão o resultado certo porque
 * `Wallet` é um objeto JS compartilhado e `debit()`/`credit()` são
 * síncronos (run-to-completion), não porque o mecanismo de lock foi
 * exercitado. Essa prova real está em
 * `process-wager-transaction.use-case.integration.test.ts`, contra
 * Postgres de verdade.
 */
describe('ProcessWagerTransactionUseCase', () => {
  it('processa um BET com saldo suficiente: debita e gera 1 lançamento DEBIT', async () => {
    const { useCase, walletLedgerEntryRepository, walletRepository, outboxMessageRepository } =
      setup();
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    wallet.credit(Money.fromString('100.00', 'BRL'));
    walletRepository.seed(wallet);

    const result = await useCase.execute(betCommand());

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.idempotentReplay).toBe(false);
    expect(result.balance).toEqual({ amount: '20.00', currency: 'BRL' });
    expect(walletLedgerEntryRepository.entries).toHaveLength(1);
    expect(walletLedgerEntryRepository.entries[0]?.direction).toBe(LedgerDirection.Debit);

    // Processed + WalletBalanceChanged (saldo mudou de fato).
    const eventTypes = outboxMessageRepository.messages.map((m) => m.eventType).sort();
    expect(eventTypes).toEqual(['WagerTransactionProcessed', 'WalletBalanceChanged'].sort());
  });

  it('rejeita um BET sem saldo suficiente: não move saldo, não gera ledger', async () => {
    const { useCase, walletLedgerEntryRepository, walletRepository, outboxMessageRepository } =
      setup();
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    wallet.credit(Money.fromString('50.00', 'BRL'));
    walletRepository.seed(wallet);

    const result = await useCase.execute(betCommand());

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.failureCode).toBe('INSUFFICIENT_BALANCE');
    expect(result.balance).toEqual({ amount: '50.00', currency: 'BRL' });
    expect(walletLedgerEntryRepository.entries).toHaveLength(0);

    // Só Rejected — nunca WalletBalanceChanged, o saldo não mudou.
    expect(outboxMessageRepository.messages.map((m) => m.eventType)).toEqual([
      'WagerTransactionRejected',
    ]);
  });

  it('processa um WIN: credita e gera 1 lançamento CREDIT', async () => {
    const { useCase, walletLedgerEntryRepository, walletRepository } = setup();
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    walletRepository.seed(wallet);

    const result = await useCase.execute(
      betCommand({
        kind: WagerTransactionKind.Win,
        amount: '150.00',
        externalTransactionId: 'tx-win',
      }),
    );

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance).toEqual({ amount: '150.00', currency: 'BRL' });
    expect(walletLedgerEntryRepository.entries[0]?.direction).toBe(LedgerDirection.Credit);
  });

  it('processa uma OPENING: credita igual um WIN', async () => {
    const { useCase, walletRepository } = setup();
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    walletRepository.seed(wallet);

    const result = await useCase.execute(
      betCommand({
        kind: WagerTransactionKind.Opening,
        amount: '1000.00',
        externalTransactionId: 'tx-open',
      }),
    );

    expect(result.balance).toEqual({ amount: '1000.00', currency: 'BRL' });
  });

  it('processa uma LOSS: não move saldo e não gera ledger, mas fica Processed', async () => {
    const { useCase, walletLedgerEntryRepository, walletRepository, outboxMessageRepository } =
      setup();
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    wallet.credit(Money.fromString('100.00', 'BRL'));
    walletRepository.seed(wallet);

    const result = await useCase.execute(
      betCommand({ kind: WagerTransactionKind.Loss, externalTransactionId: 'tx-loss' }),
    );

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(walletLedgerEntryRepository.entries).toHaveLength(0);

    // Processed sozinho — sem WalletBalanceChanged, LOSS não move saldo.
    expect(outboxMessageRepository.messages.map((m) => m.eventType)).toEqual([
      'WagerTransactionProcessed',
    ]);
  });

  it('rejeita REFUND/ROLLBACK como kind não suportado ainda (Parte 7)', async () => {
    const { useCase, walletRepository } = setup();
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    walletRepository.seed(wallet);

    await expect(
      useCase.execute(
        betCommand({ kind: WagerTransactionKind.Refund, referenceExternalTransactionId: 'tx-1' }),
      ),
    ).rejects.toThrow(UnsupportedWagerKindError);
  });

  it('lança WalletNotFoundError quando a wallet não existe', async () => {
    const { useCase } = setup();

    await expect(useCase.execute(betCommand({ walletId: 'wallet-inexistente' }))).rejects.toThrow(
      'not found',
    );
  });

  it('replay de idempotencyKey: retorna o resultado original sem reprocessar', async () => {
    const { useCase, walletLedgerEntryRepository, walletRepository } = setup();
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    wallet.credit(Money.fromString('100.00', 'BRL'));
    walletRepository.seed(wallet);

    const first = await useCase.execute(betCommand());
    const replay = await useCase.execute(betCommand());

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.transactionId).toBe(first.transactionId);
    expect(replay.status).toBe(first.status);
    expect(replay.balance).toEqual(first.balance);
    // Não gerou um segundo lançamento nem debitou de novo.
    expect(walletLedgerEntryRepository.entries).toHaveLength(1);
    expect(wallet.currentBalance.toString()).toBe('20.00');
  });

  it('replay de uma rejeição também retorna o resultado original (rejeitado de novo, sem reprocessar)', async () => {
    const { useCase, walletRepository } = setup();
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    wallet.credit(Money.fromString('50.00', 'BRL'));
    walletRepository.seed(wallet);

    const first = await useCase.execute(betCommand());
    const replay = await useCase.execute(betCommand());

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.status).toBe(WagerTransactionStatus.Rejected);
    expect(replay.failureCode).toBe(first.failureCode);
    expect(replay.balance).toEqual({ amount: '50.00', currency: 'BRL' });
  });

  it('duas apostas de 80 sobre 100, aplicadas em sequência: só a primeira processa', async () => {
    // Sequencial de propósito (await, não Promise.all) — ver nota do
    // describe() sobre o que este arquivo prova.
    const { useCase, walletLedgerEntryRepository, walletRepository } = setup();
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    wallet.credit(Money.fromString('100.00', 'BRL'));
    walletRepository.seed(wallet);

    const first = await useCase.execute(
      betCommand({ externalTransactionId: 'tx-a', idempotencyKey: 'provider-a:tx-a' }),
    );
    const second = await useCase.execute(
      betCommand({ externalTransactionId: 'tx-b', idempotencyKey: 'provider-a:tx-b' }),
    );

    expect(first.status).toBe(WagerTransactionStatus.Processed);
    expect(second.status).toBe(WagerTransactionStatus.Rejected);
    expect(second.balance).toEqual({ amount: '20.00', currency: 'BRL' });
    expect(walletLedgerEntryRepository.entries).toHaveLength(1);
  });
});
