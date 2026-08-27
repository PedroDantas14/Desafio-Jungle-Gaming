import { describe, expect, it } from 'bun:test';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Money } from '../../../shared/domain/money';
import { Wallet } from '../domain/wallet';
import { LedgerDirection, WalletLedgerEntry } from '../domain/wallet-ledger-entry';
import { WalletNotFoundError } from '../domain/wallet.errors';
import {
  type LedgerPage,
  type WalletLedgerEntryRepository,
} from './ports/wallet-ledger-entry.repository';
import { type WalletRepository } from './ports/wallet.repository';
import { ReconcileWalletUseCase } from './reconcile-wallet.use-case';

class FakeEntityManager {
  async transactional<T>(cb: (em: unknown) => Promise<T>): Promise<T> {
    return cb(this);
  }

  async flush(): Promise<void> {}
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
    return this.byId.get(id) ?? null;
  }

  async findByPlayerAndCurrency(): Promise<Wallet | null> {
    return null;
  }

  async save(wallet: Wallet): Promise<void> {
    this.byId.set(wallet.id, wallet);
  }
}

class FakeWalletLedgerEntryRepository implements WalletLedgerEntryRepository {
  private readonly entries: WalletLedgerEntry[] = [];

  seed(entry: WalletLedgerEntry): void {
    this.entries.push(entry);
  }

  async save(entry: WalletLedgerEntry): Promise<void> {
    this.entries.push(entry);
  }

  async findByTransactionId(transactionId: string): Promise<WalletLedgerEntry | null> {
    return this.entries.find((entry) => entry.transactionId === transactionId) ?? null;
  }

  async findPage(): Promise<LedgerPage> {
    return { entries: this.entries };
  }

  async findAllByWalletId(walletId: string): Promise<WalletLedgerEntry[]> {
    return this.entries.filter((entry) => entry.walletId === walletId);
  }
}

function setup() {
  const walletRepository = new FakeWalletRepository();
  const walletLedgerEntryRepository = new FakeWalletLedgerEntryRepository();
  const useCase = new ReconcileWalletUseCase(
    new FakeEntityManager() as unknown as EntityManager,
    walletRepository,
    walletLedgerEntryRepository,
  );
  return { useCase, walletRepository, walletLedgerEntryRepository };
}

describe('ReconcileWalletUseCase', () => {
  it('reporta consistente quando o saldo bate com o encadeamento do ledger', async () => {
    const { useCase, walletRepository, walletLedgerEntryRepository } = setup();
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    wallet.credit(Money.fromString('100.00', 'BRL'));
    wallet.debit(Money.fromString('30.00', 'BRL'));
    walletRepository.seed(wallet);

    walletLedgerEntryRepository.seed(
      WalletLedgerEntry.create({
        id: 'e1',
        walletId: 'w1',
        transactionId: 't1',
        direction: LedgerDirection.Credit,
        money: Money.fromString('100.00', 'BRL'),
        balanceBefore: Money.zero('BRL'),
      }),
    );
    walletLedgerEntryRepository.seed(
      WalletLedgerEntry.create({
        id: 'e2',
        walletId: 'w1',
        transactionId: 't2',
        direction: LedgerDirection.Debit,
        money: Money.fromString('30.00', 'BRL'),
        balanceBefore: Money.fromString('100.00', 'BRL'),
      }),
    );

    const result = await useCase.execute('w1');

    expect(result.consistent).toBe(true);
    expect(result.storedBalance).toEqual({ amount: '70.00', currency: 'BRL' });
    expect(result.calculatedBalance).toEqual({ amount: '70.00', currency: 'BRL' });
    expect(result.difference).toEqual({ amount: '0.00', currency: 'BRL' });
    expect(result.checkedEntries).toBe(2);
  });

  it('reporta inconsistente e a diferença exata quando o saldo divergiu do ledger', async () => {
    const { useCase, walletRepository, walletLedgerEntryRepository } = setup();
    // Simula um saldo que ficou fora de sincronia com o ledger (não deveria
    // acontecer em operação normal — é exatamente o que a reconciliação existe pra pegar).
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    wallet.credit(Money.fromString('999.00', 'BRL'));
    walletRepository.seed(wallet);

    walletLedgerEntryRepository.seed(
      WalletLedgerEntry.create({
        id: 'e1',
        walletId: 'w1',
        transactionId: 't1',
        direction: LedgerDirection.Credit,
        money: Money.fromString('100.00', 'BRL'),
        balanceBefore: Money.zero('BRL'),
      }),
    );

    const result = await useCase.execute('w1');

    expect(result.consistent).toBe(false);
    expect(result.storedBalance).toEqual({ amount: '999.00', currency: 'BRL' });
    expect(result.calculatedBalance).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(result.difference).toEqual({ amount: '899.00', currency: 'BRL' });
  });

  it('sem lançamento nenhum: calculatedBalance zero, consistente só se stored também for zero', async () => {
    const { useCase, walletRepository } = setup();
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    walletRepository.seed(wallet);

    const result = await useCase.execute('w1');

    expect(result.consistent).toBe(true);
    expect(result.checkedEntries).toBe(0);
  });

  it('lança WalletNotFoundError pra wallet inexistente', async () => {
    const { useCase } = setup();
    await expect(useCase.execute('inexistente')).rejects.toThrow(WalletNotFoundError);
  });
});
