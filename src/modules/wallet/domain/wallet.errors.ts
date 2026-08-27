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

export class WalletNotFoundError extends DomainError {
  readonly code = 'WALLET_NOT_FOUND';

  constructor(walletId: string) {
    super(`Wallet "${walletId}" not found.`);
  }
}

export class WalletAlreadyExistsError extends DomainError {
  readonly code = 'WALLET_ALREADY_EXISTS';

  constructor(playerId: string, currency: string) {
    super(`Wallet for player "${playerId}" in currency "${currency}" already exists.`);
  }
}
