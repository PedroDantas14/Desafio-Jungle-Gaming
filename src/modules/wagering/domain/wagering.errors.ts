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

/**
 * Seção 6.3: "a mesma idempotency key com payload diferente é CONFLITO,
 * não replay." Distinto de `WALLET_ALREADY_EXISTS` (conflito de recurso)
 * — aqui o conflito é entre duas requisições que alegam ser a mesma
 * operação (mesma `idempotencyKey`) mas carregam corpos diferentes;
 * devolver o resultado antigo silenciosamente esconderia do provider que
 * a segunda requisição nunca foi processada como ele pediu.
 */
export class IdempotencyPayloadConflictError extends DomainError {
  readonly code = 'IDEMPOTENCY_PAYLOAD_CONFLICT';

  constructor(idempotencyKey: string) {
    super(
      `Idempotency key "${idempotencyKey}" was already used with a different payload.`,
    );
  }
}
