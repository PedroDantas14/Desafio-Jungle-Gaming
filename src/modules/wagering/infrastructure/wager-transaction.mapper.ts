import {
  fromMoneyEmbeddable,
  toMoneyEmbeddable,
} from '../../../shared/infrastructure/money.mapper';
import {
  FailureCode,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../domain/wager-transaction';
import { WagerTransactionOrmEntity } from './wager-transaction.orm-entity';

export class WagerTransactionMapper {
  static toDomain(row: WagerTransactionOrmEntity): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: row.id,
      providerId: row.providerId,
      externalTransactionId: row.externalTransactionId,
      idempotencyKey: row.idempotencyKey,
      payloadHash: row.payloadHash,
      walletId: row.walletId,
      playerId: row.playerId,
      roundId: row.roundId,
      gameId: row.gameId,
      kind: row.kind as WagerTransactionKind,
      money: fromMoneyEmbeddable(row.money),
      // O banco usa `null` pra "ausente"; o domínio usa `undefined` — a
      // conversão fica só aqui, na borda entre as duas camadas.
      referenceExternalTransactionId: row.referenceExternalTransactionId ?? undefined,
      createdAt: row.createdAt,
      status: row.status as WagerTransactionStatus,
      referenceTransactionId: row.referenceTransactionId ?? undefined,
      failureCode: (row.failureCode ?? undefined) as FailureCode | undefined,
      processedAt: row.processedAt ?? undefined,
    });
  }

  static toNewOrmEntity(tx: WagerTransaction): WagerTransactionOrmEntity {
    const row = new WagerTransactionOrmEntity();
    row.id = tx.id;
    row.providerId = tx.providerId;
    row.externalTransactionId = tx.externalTransactionId;
    row.idempotencyKey = tx.idempotencyKey;
    row.payloadHash = tx.payloadHash;
    row.walletId = tx.walletId;
    row.playerId = tx.playerId;
    row.roundId = tx.roundId;
    row.gameId = tx.gameId;
    row.kind = tx.kind;
    row.money = toMoneyEmbeddable(tx.money);
    row.referenceExternalTransactionId = tx.referenceExternalTransactionId;
    row.referenceTransactionId = tx.referenceTransactionId;
    row.status = tx.status;
    row.failureCode = tx.failureCode;
    row.processedAt = tx.processedAt;
    row.createdAt = tx.createdAt;
    return row;
  }

  /** Aplica mudança de estado (status/referência resolvida/failureCode/processedAt) numa linha existente. */
  static applyToExistingOrmEntity(tx: WagerTransaction, row: WagerTransactionOrmEntity): void {
    row.status = tx.status;
    row.referenceTransactionId = tx.referenceTransactionId;
    row.failureCode = tx.failureCode;
    row.processedAt = tx.processedAt;
  }
}
