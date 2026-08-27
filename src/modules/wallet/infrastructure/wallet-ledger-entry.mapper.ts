import {
  fromMoneyEmbeddable,
  toMoneyEmbeddable,
} from '../../../shared/infrastructure/money.mapper';
import { type LedgerDirection, WalletLedgerEntry } from '../domain/wallet-ledger-entry';
import { WalletLedgerEntryOrmEntity } from './wallet-ledger-entry.orm-entity';

export class WalletLedgerEntryMapper {
  static toDomain(row: WalletLedgerEntryOrmEntity): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: row.id,
      walletId: row.walletId,
      transactionId: row.transactionId,
      direction: row.direction as LedgerDirection,
      money: fromMoneyEmbeddable(row.money),
      balanceBefore: fromMoneyEmbeddable(row.balanceBefore),
      balanceAfter: fromMoneyEmbeddable(row.balanceAfter),
      createdAt: row.createdAt,
    });
  }

  /** Só existe a versão "new" — lançamento é imutável, nunca há update. */
  static toNewOrmEntity(entry: WalletLedgerEntry): WalletLedgerEntryOrmEntity {
    const row = new WalletLedgerEntryOrmEntity();
    row.id = entry.id;
    row.walletId = entry.walletId;
    row.transactionId = entry.transactionId;
    row.direction = entry.direction;
    row.money = toMoneyEmbeddable(entry.money);
    row.balanceBefore = toMoneyEmbeddable(entry.balanceBefore);
    row.balanceAfter = toMoneyEmbeddable(entry.balanceAfter);
    row.createdAt = entry.createdAt;
    return row;
  }
}
