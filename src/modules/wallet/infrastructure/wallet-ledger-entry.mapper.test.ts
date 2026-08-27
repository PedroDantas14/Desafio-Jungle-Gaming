import { describe, expect, it } from 'bun:test';
import { Money } from '../../../shared/domain/money';
import { LedgerDirection, WalletLedgerEntry } from '../domain/wallet-ledger-entry';
import { WalletLedgerEntryMapper } from './wallet-ledger-entry.mapper';

describe('WalletLedgerEntryMapper', () => {
  it('faz round-trip domínio -> linha ORM -> domínio preservando a aritmética', () => {
    const entry = WalletLedgerEntry.create({
      id: 'e1',
      walletId: 'w1',
      transactionId: 't1',
      direction: LedgerDirection.Debit,
      money: Money.fromString('80.00', 'BRL'),
      balanceBefore: Money.fromString('100.00', 'BRL'),
      createdAt: new Date('2026-08-27T00:00:00.000Z'),
    });

    const row = WalletLedgerEntryMapper.toNewOrmEntity(entry);
    const rehydrated = WalletLedgerEntryMapper.toDomain(row);

    expect(rehydrated.balanceBefore.equals(entry.balanceBefore)).toBe(true);
    expect(rehydrated.balanceAfter.equals(entry.balanceAfter)).toBe(true);
    expect(rehydrated.balanceAfter.toString()).toBe('20.00');
    expect(rehydrated.isBalanced()).toBe(true);
    expect(rehydrated.direction).toBe(LedgerDirection.Debit);
  });
});
