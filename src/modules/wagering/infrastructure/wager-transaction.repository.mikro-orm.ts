import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WagerTransactionRepository } from '../application/ports/wager-transaction.repository';
import { WagerTransaction } from '../domain/wager-transaction';
import { WagerTransactionMapper } from './wager-transaction.mapper';
import { WagerTransactionOrmEntity } from './wager-transaction.orm-entity';

@Injectable()
export class WagerTransactionRepositoryMikroOrm implements WagerTransactionRepository {
  async findByIdempotencyKey(
    idempotencyKey: string,
    em: EntityManager,
  ): Promise<WagerTransaction | null> {
    const row = await em.findOne(WagerTransactionOrmEntity, { idempotencyKey });
    return row ? WagerTransactionMapper.toDomain(row) : null;
  }

  async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
    em: EntityManager,
  ): Promise<WagerTransaction | null> {
    const row = await em.findOne(WagerTransactionOrmEntity, { providerId, externalTransactionId });
    return row ? WagerTransactionMapper.toDomain(row) : null;
  }

  async save(transaction: WagerTransaction, em: EntityManager): Promise<void> {
    const existing = await em.findOne(WagerTransactionOrmEntity, { id: transaction.id });

    if (existing) {
      WagerTransactionMapper.applyToExistingOrmEntity(transaction, existing);
    } else {
      em.persist(WagerTransactionMapper.toNewOrmEntity(transaction));
    }
  }
}
