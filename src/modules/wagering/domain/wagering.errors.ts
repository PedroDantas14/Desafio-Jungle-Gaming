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

/**
 * REFUND/ROLLBACK exigem resolver `(providerId, referenceExternalTransactionId)`
 * pra um id interno antes de aplicar efeito — máquina que só chega na
 * Parte 7. Até lá, `ProcessWagerTransactionUseCase` rejeita esses kinds
 * explicitamente em vez de aplicar algo incompleto/errado.
 */
export class UnsupportedWagerKindError extends DomainError {
  readonly code = 'UNSUPPORTED_WAGER_KIND';

  constructor(kind: string) {
    super(`Wager transaction kind "${kind}" is not supported yet.`);
  }
}
