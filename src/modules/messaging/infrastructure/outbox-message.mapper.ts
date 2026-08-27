import type { IntegrationEventEnvelope } from '../../../shared/domain/integration-event';
import { OutboxMessage } from '../domain/outbox-message';
import { OutboxMessageOrmEntity } from './outbox-message.orm-entity';

export class OutboxMessageMapper {
  static toDomain(row: OutboxMessageOrmEntity): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: row.id,
      aggregateId: row.aggregateId,
      eventType: row.eventType,
      payload: row.payload as IntegrationEventEnvelope<unknown>,
      occurredAt: row.occurredAt,
      attempts: row.attempts,
      nextAttemptAt: row.nextAttemptAt,
      publishedAt: row.publishedAt ?? undefined,
    });
  }

  static toNewOrmEntity(message: OutboxMessage): OutboxMessageOrmEntity {
    const row = new OutboxMessageOrmEntity();
    row.id = message.id;
    row.aggregateId = message.aggregateId;
    row.eventType = message.eventType;
    row.payload = message.payload;
    row.occurredAt = message.occurredAt;
    row.attempts = message.attempts;
    row.nextAttemptAt = message.nextAttemptAt;
    row.publishedAt = message.publishedAt ?? null;
    return row;
  }

  static applyToExistingOrmEntity(message: OutboxMessage, row: OutboxMessageOrmEntity): void {
    row.attempts = message.attempts;
    row.nextAttemptAt = message.nextAttemptAt;
    row.publishedAt = message.publishedAt ?? null;
  }
}
