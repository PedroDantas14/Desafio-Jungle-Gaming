import { Injectable } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { InboxMessageRepository } from '../application/ports/inbox-message.repository';
import type { InboxMessage } from '../domain/inbox-message';
import { InboxMessageMapper } from './inbox-message.mapper';
import { InboxMessageOrmEntity } from './inbox-message.orm-entity';

@Injectable()
export class InboxMessageRepositoryMikroOrm implements InboxMessageRepository {
  async findByConsumerAndMessageId(
    consumerName: string,
    messageId: string,
    em: EntityManager,
  ): Promise<InboxMessage | null> {
    const row = await em.findOne(InboxMessageOrmEntity, { consumerName, messageId });
    return row ? InboxMessageMapper.toDomain(row) : null;
  }

  async save(message: InboxMessage, em: EntityManager): Promise<void> {
    const existing = await em.findOne(InboxMessageOrmEntity, {
      consumerName: message.consumerName,
      messageId: message.messageId,
    });

    if (existing) {
      InboxMessageMapper.applyToExistingOrmEntity(message, existing);
    } else {
      em.persist(InboxMessageMapper.toNewOrmEntity(message));
    }
  }
}
