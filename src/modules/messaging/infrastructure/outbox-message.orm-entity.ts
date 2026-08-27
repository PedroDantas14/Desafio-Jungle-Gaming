import { defineEntity } from '@mikro-orm/postgresql';

/**
 * Linha da tabela `outbox_messages`. `payload` guarda o envelope
 * completo do evento como JSONB — é o que o worker de publicação lê e
 * manda pro SQS, sem precisar reconstruir nada a partir de outras
 * colunas.
 */
export const OutboxMessageSchema = defineEntity({
  name: 'OutboxMessage',
  tableName: 'outbox_messages',
  properties: (p) => ({
    id: p.uuid().primary(),
    aggregateId: p.uuid(),
    eventType: p.text(),
    payload: p.json(),
    occurredAt: p.datetime(),
    attempts: p.integer(),
    nextAttemptAt: p.datetime(),
    publishedAt: p.datetime().nullable(),
  }),
});

export class OutboxMessageOrmEntity extends OutboxMessageSchema.class {}
OutboxMessageSchema.setClass(OutboxMessageOrmEntity);
