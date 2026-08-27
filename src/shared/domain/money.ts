import {
  CurrencyMismatchError,
  InvalidCurrencyError,
  InvalidMoneyAmountError,
} from './money.errors';

// Formato estrito de escala fixa: sinal opcional, pelo menos um dígito
// inteiro, exatamente 2 casas decimais. Sem notação científica, sem
// separador de milhar.
const MONEY_PATTERN = /^(-?)(\d+)\.(\d{2})$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Value object monetário imutável.
 *
 * Representado internamente como uma contagem inteira exata de unidades
 * menores (centavos) — um `bigint`, nunca um `number`/`float`/`double` —
 * então a aritmética nunca perde precisão nem sofre o desvio silencioso
 * típico de float IEEE-754 (0.1 + 0.2 !== 0.3). O único lugar onde decimais
 * existem como texto é na fronteira com string (`fromString` / `toString`).
 */
export class Money {
  static readonly DECIMAL_SCALE = 2;

  private constructor(
    private readonly minorUnits: bigint,
    private readonly currency: string,
  ) {
    Object.freeze(this);
  }

  static zero(currency: string): Money {
    return new Money(0n, Money.normalizeCurrency(currency));
  }

  static fromString(amount: string, currency: string): Money {
    const match = MONEY_PATTERN.exec(amount.trim());
    if (!match) {
      throw new InvalidMoneyAmountError(amount);
    }

    const sign = match[1];
    const integerPart = match[2] as string;
    const fractionalPart = match[3] as string;

    const magnitude = BigInt(integerPart) * 100n + BigInt(fractionalPart);
    const minorUnits = sign === '-' ? -magnitude : magnitude;

    return new Money(minorUnits, Money.normalizeCurrency(currency));
  }

  static fromMinorUnits(minorUnits: bigint, currency: string): Money {
    return new Money(minorUnits, Money.normalizeCurrency(currency));
  }

  private static normalizeCurrency(currency: string): string {
    if (!CURRENCY_PATTERN.test(currency)) {
      throw new InvalidCurrencyError(currency);
    }
    return currency;
  }

  get currencyCode(): string {
    return this.currency;
  }

  toMinorUnits(): bigint {
    return this.minorUnits;
  }

  toString(): string {
    const negative = this.minorUnits < 0n;
    const absolute = negative ? -this.minorUnits : this.minorUnits;
    const integerPart = absolute / 100n;
    const fractionalPart = absolute % 100n;
    const sign = negative ? '-' : '';
    return `${sign}${integerPart.toString()}.${fractionalPart.toString().padStart(2, '0')}`;
  }

  /** Permite que `JSON.stringify` serialize Money na forma de string de escala fixa. */
  toJSON(): string {
    return this.toString();
  }

  add(other: Money): Money {
    this.ensureSameCurrency(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  subtract(other: Money): Money {
    this.ensureSameCurrency(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  negate(): Money {
    return new Money(-this.minorUnits, this.currency);
  }

  isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  isZero(): boolean {
    return this.minorUnits === 0n;
  }

  isPositive(): boolean {
    return this.minorUnits > 0n;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minorUnits === other.minorUnits;
  }

  isGreaterThanOrEqual(other: Money): boolean {
    this.ensureSameCurrency(other);
    return this.minorUnits >= other.minorUnits;
  }

  isLessThan(other: Money): boolean {
    this.ensureSameCurrency(other);
    return this.minorUnits < other.minorUnits;
  }

  private ensureSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
