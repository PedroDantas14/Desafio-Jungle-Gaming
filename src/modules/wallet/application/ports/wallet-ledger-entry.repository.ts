import type { EntityManager } from '@mikro-orm/postgresql';
import { type WalletLedgerEntry } from '../../domain/wallet-ledger-entry';

/** `abstract class`, não `interface` — ver nota em `id-generator.ts`. */
export abstract class WalletLedgerEntryRepository {
  /** Só insert — lançamento é imutável, nunca há update/delete (seção 6.4). */
  abstract save(entry: WalletLedgerEntry, em: EntityManager): Promise<void>;

  /** Usado no replay de idempotência: no máx. 1 lançamento por transação. */
  abstract findByTransactionId(
    transactionId: string,
    em: EntityManager,
  ): Promise<WalletLedgerEntry | null>;
}
