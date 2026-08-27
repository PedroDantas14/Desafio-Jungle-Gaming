import {
  fromMoneyEmbeddable,
  toMoneyEmbeddable,
} from '../../../shared/infrastructure/money.mapper';
import { Wallet } from '../domain/wallet';
import { WalletOrmEntity } from './wallet.orm-entity';

export class WalletMapper {
  static toDomain(row: WalletOrmEntity): Wallet {
    return Wallet.rehydrate({
      id: row.id,
      playerId: row.playerId,
      balance: fromMoneyEmbeddable(row.balance),
      version: row.version,
    });
  }

  static toNewOrmEntity(wallet: Wallet, now: Date): WalletOrmEntity {
    const row = new WalletOrmEntity();
    row.id = wallet.id;
    row.playerId = wallet.playerId;
    row.balance = toMoneyEmbeddable(wallet.currentBalance);
    row.version = wallet.currentVersion;
    row.createdAt = now;
    row.updatedAt = now;
    return row;
  }

  /** Aplica o estado atual do aggregate numa linha ORM já carregada (update). */
  static applyToExistingOrmEntity(wallet: Wallet, row: WalletOrmEntity, now: Date): void {
    row.balance = toMoneyEmbeddable(wallet.currentBalance);
    row.version = wallet.currentVersion;
    row.updatedAt = now;
  }
}
