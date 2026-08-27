import { InboxMessage } from '../domain/inbox-message';
import { InboxMessageOrmEntity } from './inbox-message.orm-entity';

export class InboxMessageMapper {
  static toDomain(row: InboxMessageOrmEntity): InboxMessage {
    return InboxMessage.rehydrate({
      messageId: row.messageId,
      consumerName: row.consumerName,
      payloadHash: row.payloadHash,
      receivedAt: row.receivedAt,
      processedAt: row.processedAt ?? undefined,
    });
  }

  static toNewOrmEntity(message: InboxMessage): InboxMessageOrmEntity {
    const row = new InboxMessageOrmEntity();
    row.messageId = message.messageId;
    row.consumerName = message.consumerName;
    row.payloadHash = message.payloadHash;
    row.receivedAt = message.receivedAt;
    row.processedAt = message.processedAt ?? null;
    return row;
  }

  static applyToExistingOrmEntity(message: InboxMessage, row: InboxMessageOrmEntity): void {
    row.processedAt = message.processedAt ?? null;
  }
}
