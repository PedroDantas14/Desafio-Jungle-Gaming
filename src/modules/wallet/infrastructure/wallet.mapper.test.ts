import { describe, expect, it } from 'bun:test';
import { Money } from '../../../shared/domain/money';
import { Wallet } from '../domain/wallet';
import { WalletMapper } from './wallet.mapper';

describe('WalletMapper', () => {
  it('faz round-trip domínio -> linha ORM -> domínio sem perder estado', () => {
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    wallet.credit(Money.fromString('100.00', 'BRL'));
    wallet.debit(Money.fromString('80.00', 'BRL'));

    const row = WalletMapper.toNewOrmEntity(wallet, new Date('2026-08-27T00:00:00.000Z'));
    const rehydrated = WalletMapper.toDomain(row);

    expect(rehydrated.id).toBe(wallet.id);
    expect(rehydrated.playerId).toBe(wallet.playerId);
    expect(rehydrated.currentBalance.equals(wallet.currentBalance)).toBe(true);
    expect(rehydrated.currentVersion).toBe(wallet.currentVersion);
  });

  it('applyToExistingOrmEntity atualiza balance/version/updatedAt sem tocar id/playerId/createdAt', () => {
    const wallet = Wallet.create({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    const createdAt = new Date('2026-08-27T00:00:00.000Z');
    const row = WalletMapper.toNewOrmEntity(wallet, createdAt);

    wallet.credit(Money.fromString('50.00', 'BRL'));
    const updatedAt = new Date('2026-08-27T01:00:00.000Z');
    WalletMapper.applyToExistingOrmEntity(wallet, row, updatedAt);

    expect(row.balance.minorUnits).toBe(5000n);
    expect(row.version).toBe(1);
    expect(row.createdAt).toBe(createdAt);
    expect(row.updatedAt).toBe(updatedAt);
  });
});
