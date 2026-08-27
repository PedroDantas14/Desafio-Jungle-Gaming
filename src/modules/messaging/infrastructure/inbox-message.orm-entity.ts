import { defineEntity } from '@mikro-orm/postgresql';

/**
 * Linha da tabela `inbox_messages`. Chave primária composta
 * `(consumerName, messageId)` — bate direto com a identidade natural de
 * dedup do domínio (seção 6.5), sem precisar de um id sintético.
 */
export const InboxMessageSchema = defineEntity({
  name: 'InboxMessage',
  tableName: 'inbox_messages',
  properties: (p) => ({
    consumerName: p.text().primary(),
    messageId: p.text().primary(),
    payloadHash: p.text(),
    receivedAt: p.datetime(),
    processedAt: p.datetime().nullable(),
  }),
});

export class InboxMessageOrmEntity extends InboxMessageSchema.class {}
InboxMessageSchema.setClass(InboxMessageOrmEntity);
