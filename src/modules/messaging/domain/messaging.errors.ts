import { DomainError } from '../../../shared/domain/domain-error';

export class InvalidOutboxMessageError extends DomainError {
  readonly code = 'INVALID_OUTBOX_MESSAGE';

  constructor(reason: string) {
    super(`Invalid outbox message: ${reason}`);
  }
}

/** Payload de mensagem SQS malformado — erro de negócio (terminal, nunca adianta reenviar). */
export class InvalidWagerMessageError extends DomainError {
  readonly code = 'INVALID_WAGER_MESSAGE';

  constructor(reason: string) {
    super(`Invalid wager transaction message: ${reason}`);
  }
}
