import { describe, expect, it } from 'bun:test';
import {
  CurrencyMismatchError,
  InvalidCurrencyError,
  InvalidMoneyAmountError,
} from './money.errors';
import { Money } from './money';

describe('Money', () => {
  it('parses a valid fixed-scale string amount', () => {
    const money = Money.fromString('100.00', 'BRL');
    expect(money.toString()).toBe('100.00');
    expect(money.currencyCode).toBe('BRL');
  });

  it('rejects amounts that are not exactly 2 decimal places', () => {
    expect(() => Money.fromString('100', 'BRL')).toThrow(InvalidMoneyAmountError);
    expect(() => Money.fromString('100.0', 'BRL')).toThrow(InvalidMoneyAmountError);
    expect(() => Money.fromString('100.000', 'BRL')).toThrow(InvalidMoneyAmountError);
    expect(() => Money.fromString('abc', 'BRL')).toThrow(InvalidMoneyAmountError);
  });

  it('rejects invalid currency codes', () => {
    expect(() => Money.fromString('100.00', 'brl')).toThrow(InvalidCurrencyError);
    expect(() => Money.fromString('100.00', 'BR')).toThrow(InvalidCurrencyError);
    expect(() => Money.fromString('100.00', 'BRLX')).toThrow(InvalidCurrencyError);
  });

  it('adds and subtracts amounts in the same currency', () => {
    const a = Money.fromString('100.00', 'BRL');
    const b = Money.fromString('80.00', 'BRL');
    expect(a.subtract(b).toString()).toBe('20.00');
    expect(a.add(b).toString()).toBe('180.00');
  });

  it('throws when operating across different currencies', () => {
    const brl = Money.fromString('100.00', 'BRL');
    const usd = Money.fromString('100.00', 'USD');
    expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.subtract(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.isLessThan(usd)).toThrow(CurrencyMismatchError);
  });

  it('represents negative results exactly, without drift', () => {
    const a = Money.fromString('10.00', 'BRL');
    const b = Money.fromString('10.01', 'BRL');
    const result = a.subtract(b);
    expect(result.isNegative()).toBe(true);
    expect(result.toString()).toBe('-0.01');
  });

  it('never loses precision across repeated arithmetic (unlike IEEE-754 float)', () => {
    // Com `number`, 0.1 + 0.2 !== 0.3 e somar 0.10 dez vezes desvia de
    // 1.00. Money é baseado em centavos bigint, então isso é exato.
    let total = Money.zero('BRL');
    const tenCents = Money.fromString('0.10', 'BRL');
    for (let i = 0; i < 10; i += 1) {
      total = total.add(tenCents);
    }
    expect(total.toString()).toBe('1.00');
  });

  it('compares amounts', () => {
    const a = Money.fromString('100.00', 'BRL');
    const b = Money.fromString('80.00', 'BRL');
    expect(a.isGreaterThanOrEqual(b)).toBe(true);
    expect(b.isLessThan(a)).toBe(true);
    expect(a.equals(Money.fromString('100.00', 'BRL'))).toBe(true);
    expect(a.equals(b)).toBe(false);
  });

  it('serializes to its fixed-scale string form via toJSON', () => {
    const money = Money.fromString('42.50', 'BRL');
    expect(JSON.stringify({ balance: money })).toBe('{"balance":"42.50"}');
  });
});
