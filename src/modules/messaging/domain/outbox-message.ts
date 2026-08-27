import type {
  IntegrationEvent,
  IntegrationEventEnvelope,
} from '../../../shared/domain/integration-event';

const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60 * 1_000;

/** 2s, 4s, 8s, 16s... até o teto de 5 minutos. */
function computeBackoffDelayMs(attempts: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attempts, MAX_DELAY_MS);
}

export interface EnqueueOutboxMessageParams {
  id: string;
  event: IntegrationEvent<unknown>;
}

export interface RehydrateOutboxMessageParams {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: IntegrationEventEnvelope<unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date;
  publishedAt?: Date;
}

/**
 * Fila de eventos pendentes de publicação (seção 6.5/11 — transactional
 * outbox). `payload` guarda o envelope completo (`IntegrationEvent.toJSON()`)
 * — é o que o worker de publicação manda pro SQS sem precisar reconstruir
 * nada. `aggregateId`/`eventType` ficam replicados como colunas próprias
 * só pra filtro/índice, não são a fonte da verdade.
 */
export class OutboxMessage {
  private _attempts: number;
  private _nextAttemptAt: Date;
  private _publishedAt?: Date;

  private constructor(
    readonly id: string,
    readonly aggregateId: string,
    readonly eventType: string,
    readonly payload: IntegrationEventEnvelope<unknown>,
    readonly occurredAt: Date,
    attempts: number,
    nextAttemptAt: Date,
    publishedAt?: Date,
  ) {
    this._attempts = attempts;
    this._nextAttemptAt = nextAttemptAt;
    this._publishedAt = publishedAt;
  }

  static enqueue(params: EnqueueOutboxMessageParams): OutboxMessage {
    const envelope = params.event.toJSON();
    const now = new Date();
    return new OutboxMessage(
      params.id,
      envelope.aggregateId,
      envelope.eventType,
      envelope,
      now,
      0,
      now,
    );
  }

  static rehydrate(params: RehydrateOutboxMessageParams): OutboxMessage {
    return new OutboxMessage(
      params.id,
      params.aggregateId,
      params.eventType,
      params.payload,
      params.occurredAt,
      params.attempts,
      params.nextAttemptAt,
      params.publishedAt,
    );
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date {
    return this._nextAttemptAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  get isPublished(): boolean {
    return this._publishedAt !== undefined;
  }

  markPublished(at: Date = new Date()): void {
    this._publishedAt = at;
  }

  scheduleRetry(now: Date = new Date()): void {
    this._attempts += 1;
    this._nextAttemptAt = new Date(now.getTime() + computeBackoffDelayMs(this._attempts));
  }
}
