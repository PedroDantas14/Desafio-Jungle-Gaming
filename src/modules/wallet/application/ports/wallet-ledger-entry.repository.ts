import type { EntityManager } from '@mikro-orm/postgresql';
import { type WalletLedgerEntry } from '../../domain/wallet-ledger-entry';

export interface LedgerPage {
  entries: WalletLedgerEntry[];
  nextCursor?: string;
}

/** `abstract class`, não `interface` — ver nota em `id-generator.ts`. */
export abstract class WalletLedgerEntryRepository {
  /** Só insert — lançamento é imutável, nunca há update/delete (seção 6.4). */
  abstract save(entry: WalletLedgerEntry, em: EntityManager): Promise<void>;

  /** Usado no replay de idempotência: no máx. 1 lançamento por transação. */
  abstract findByTransactionId(
    transactionId: string,
    em: EntityManager,
  ): Promise<WalletLedgerEntry | null>;

  /**
   * `GET /wallets/:id/ledger?cursor=&limit=` (seção 9). Cursor opaco = id
   * do último lançamento da página anterior — funciona porque o id é
   * UUIDv7 (ordenável por tempo), sem precisar de uma coluna própria de
   * paginação. Mais recente primeiro.
   */
  abstract findPage(
    walletId: string,
    options: { cursor?: string; limit: number },
    em: EntityManager,
  ): Promise<LedgerPage>;

  /**
   * Todos os lançamentos da wallet, mais antigo primeiro — só usado pela
   * reconciliação (seção 9), que precisa percorrer a cadeia inteira pra
   * conferir `balanceBefore`/`balanceAfter` de ponta a ponta. Sem
   * paginação de propósito: é uma operação de auditoria, não de listagem
   * de UI. Conhecidamente não escala pra wallets com histórico enorme —
   * ver ARCHITECTURE.md.
   */
  abstract findAllByWalletId(walletId: string, em: EntityManager): Promise<WalletLedgerEntry[]>;
}
