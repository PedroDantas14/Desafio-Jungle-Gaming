import { describe, expect, it } from 'bun:test';
import type { EntityManager } from '@mikro-orm/postgresql';
import { type IdGenerator } from '../../../shared/application/id-generator';
import { type Wallet } from '../domain/wallet';
import { WalletAlreadyExistsError } from '../domain/wallet.errors';
import { CreateWalletUseCase } from './create-wallet.use-case';
import { type WalletRepository } from './ports/wallet.repository';

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

  async findById(id: string): Promise<Wallet | null> {
    return this.byId.get(id) ?? null;
  }

  async findByIdForUpdate(id: string): Promise<Wallet | null> {
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

function setup() {
  const walletRepository = new FakeWalletRepository();
  const useCase = new CreateWalletUseCase(
    new FakeEntityManager() as unknown as EntityManager,
    walletRepository,
    new SequentialIdGenerator(),
  );
  return { useCase, walletRepository };
}

describe('CreateWalletUseCase', () => {
  it('cria uma wallet nova com saldo zero', async () => {
    const { useCase } = setup();

    const result = await useCase.execute({ playerId: 'p1', currency: 'BRL' });

    expect(result.playerId).toBe('p1');
    expect(result.balance).toEqual({ amount: '0.00', currency: 'BRL' });
    expect(result.version).toBe(0);
  });

  it('rejeita criar uma segunda wallet pro mesmo player+moeda', async () => {
    const { useCase } = setup();
    await useCase.execute({ playerId: 'p1', currency: 'BRL' });

    await expect(useCase.execute({ playerId: 'p1', currency: 'BRL' })).rejects.toThrow(
      WalletAlreadyExistsError,
    );
  });

  it('permite o mesmo player com moedas diferentes', async () => {
    const { useCase } = setup();
    await useCase.execute({ playerId: 'p1', currency: 'BRL' });

    const usd = await useCase.execute({ playerId: 'p1', currency: 'USD' });
    expect(usd.balance.currency).toBe('USD');
  });
});
