import { DomainError } from '../../../shared/domain/domain-error';

export class InsufficientBalanceError extends DomainError {
  readonly code = 'INSUFFICIENT_BALANCE';

  constructor(walletId: string, balance: string, amount: string) {
    super(
      `Wallet "${walletId}" has insufficient balance: balance=${balance}, requested debit=${amount}.`,
    );
  }
}

export class InvalidLedgerEntryError extends DomainError {
  readonly code = 'INVALID_LEDGER_ENTRY';

  constructor(reason: string) {
    super(`Invalid ledger entry: ${reason}`);
  }
}
