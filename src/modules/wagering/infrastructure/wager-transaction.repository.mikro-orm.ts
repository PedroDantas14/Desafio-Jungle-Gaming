import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WagerTransactionRepository } from '../application/ports/wager-transaction.repository';
import {
  WagerTransaction,
  WagerTransactionStatus,
  type WagerTransactionKind,
} from '../domain/wager-transaction';
import { WagerTransactionMapper } from './wager-transaction.mapper';
import { WagerTransactionOrmEntity } from './wager-transaction.orm-entity';

@Injectable()
export class WagerTransactionRepositoryMikroOrm implements WagerTransactionRepository {
  async findById(id: string, em: EntityManager): Promise<WagerTransaction | null> {
    const row = await em.findOne(WagerTransactionOrmEntity, { id });
    return row ? WagerTransactionMapper.toDomain(row) : null;
  }

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

  async existsProcessedReversal(
    referenceTransactionId: string,
    kind: WagerTransactionKind,
    em: EntityManager,
  ): Promise<boolean> {
    const count = await em.count(WagerTransactionOrmEntity, {
      referenceTransactionId,
      kind,
      status: WagerTransactionStatus.Processed,
    });
    return count > 0;
  }

  async findPendingReferenceBatch(limit: number, em: EntityManager): Promise<WagerTransaction[]> {
    const rows = await em.find(
      WagerTransactionOrmEntity,
      { status: WagerTransactionStatus.PendingReference },
      { orderBy: { createdAt: 'asc' }, limit },
    );
    return rows.map((row) => WagerTransactionMapper.toDomain(row));
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
