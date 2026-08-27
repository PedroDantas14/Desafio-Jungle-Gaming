import { DomainError } from './domain-error';

export class InvalidMoneyAmountError extends DomainError {
  readonly code = 'INVALID_MONEY_AMOUNT';

  constructor(amount: string) {
    super(`Invalid money amount "${amount}" — expected a fixed 2-decimal value, e.g. "100.00".`);
  }
}

export class InvalidCurrencyError extends DomainError {
  readonly code = 'INVALID_CURRENCY';

  constructor(currency: string) {
    super(
      `Invalid currency code "${currency}" — expected a 3-letter uppercase ISO code, e.g. "BRL".`,
    );
  }
}

export class CurrencyMismatchError extends DomainError {
  readonly code = 'CURRENCY_MISMATCH';

  constructor(expected: string, received: string) {
    super(`Currency mismatch: expected "${expected}", received "${received}".`);
  }
}
