import { Injectable } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { OutboxMessageRepository } from '../application/ports/outbox-message.repository';
import type { OutboxMessage } from '../domain/outbox-message';
import { OutboxMessageMapper } from './outbox-message.mapper';
import { OutboxMessageOrmEntity } from './outbox-message.orm-entity';

@Injectable()
export class OutboxMessageRepositoryMikroOrm implements OutboxMessageRepository {
  async claimDue(limit: number, em: EntityManager): Promise<OutboxMessage[]> {
    const rows = await em.find(
      OutboxMessageOrmEntity,
      { publishedAt: null, nextAttemptAt: { $lte: new Date() } },
      { lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE, limit, orderBy: { nextAttemptAt: 'asc' } },
    );
    return rows.map((row) => OutboxMessageMapper.toDomain(row));
  }

  async save(message: OutboxMessage, em: EntityManager): Promise<void> {
    const existing = await em.findOne(OutboxMessageOrmEntity, { id: message.id });

    if (existing) {
      OutboxMessageMapper.applyToExistingOrmEntity(message, existing);
    } else {
      em.persist(OutboxMessageMapper.toNewOrmEntity(message));
    }
  }
}
