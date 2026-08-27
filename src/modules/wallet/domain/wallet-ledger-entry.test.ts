import { describe, expect, it } from 'bun:test';
import { Money } from '../../../shared/domain/money';
import { LedgerDirection, WalletLedgerEntry } from './wallet-ledger-entry';
import { InvalidLedgerEntryError } from './wallet.errors';

describe('WalletLedgerEntry', () => {
  it('registra um débito e deriva o saldo resultante', () => {
    const entry = WalletLedgerEntry.create({
      id: 'e1',
      walletId: 'w1',
      transactionId: 't1',
      direction: LedgerDirection.Debit,
      money: Money.fromString('80.00', 'BRL'),
      balanceBefore: Money.fromString('100.00', 'BRL'),
    });
    expect(entry.balanceAfter.toString()).toBe('20.00');
    expect(entry.isBalanced()).toBe(true);
  });

  it('registra um crédito e deriva o saldo resultante', () => {
    const entry = WalletLedgerEntry.create({
      id: 'e1',
      walletId: 'w1',
      transactionId: 't1',
      direction: LedgerDirection.Credit,
      money: Money.fromString('50.00', 'BRL'),
      balanceBefore: Money.fromString('100.00', 'BRL'),
    });
    expect(entry.balanceAfter.toString()).toBe('150.00');
    expect(entry.isBalanced()).toBe(true);
  });

  it('rejeita um débito que deixaria um saldo negativo', () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: 'e1',
        walletId: 'w1',
        transactionId: 't1',
        direction: LedgerDirection.Debit,
        money: Money.fromString('150.00', 'BRL'),
        balanceBefore: Money.fromString('100.00', 'BRL'),
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('rejeita um valor não positivo', () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: 'e1',
        walletId: 'w1',
        transactionId: 't1',
        direction: LedgerDirection.Credit,
        money: Money.zero('BRL'),
        balanceBefore: Money.fromString('100.00', 'BRL'),
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('reidrata uma linha existente quando a aritmética bate', () => {
    const entry = WalletLedgerEntry.rehydrate({
      id: 'e1',
      walletId: 'w1',
      transactionId: 't1',
      direction: LedgerDirection.Debit,
      money: Money.fromString('80.00', 'BRL'),
      balanceBefore: Money.fromString('100.00', 'BRL'),
      balanceAfter: Money.fromString('20.00', 'BRL'),
    });
    expect(entry.balanceAfter.toString()).toBe('20.00');
  });

  it('rejeita a reidratação quando o balanceAfter armazenado não bate com a aritmética', () => {
    expect(() =>
      WalletLedgerEntry.rehydrate({
        id: 'e1',
        walletId: 'w1',
        transactionId: 't1',
        direction: LedgerDirection.Debit,
        money: Money.fromString('80.00', 'BRL'),
        balanceBefore: Money.fromString('100.00', 'BRL'),
        balanceAfter: Money.fromString('50.00', 'BRL'), // ex.: uma linha corrompida/adulterada
      }),
    ).toThrow(InvalidLedgerEntryError);
  });
});
