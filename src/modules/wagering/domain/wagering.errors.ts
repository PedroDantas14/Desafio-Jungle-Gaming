import { DomainError } from '../../../shared/domain/domain-error';

export class InvalidWagerTransactionError extends DomainError {
  readonly code = 'INVALID_WAGER_TRANSACTION';

  constructor(reason: string) {
    super(`Invalid wager transaction: ${reason}`);
  }
}

export class InvalidStateTransitionError extends DomainError {
  readonly code = 'INVALID_STATE_TRANSITION';

  constructor(transactionId: string, from: string, to: string) {
    super(`Wager transaction "${transactionId}" cannot transition from ${from} to ${to}.`);
  }
}
