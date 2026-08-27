import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  type LedgerPage,
  WalletLedgerEntryRepository,
} from '../application/ports/wallet-ledger-entry.repository';
import { WalletLedgerEntry } from '../domain/wallet-ledger-entry';
import { WalletLedgerEntryMapper } from './wallet-ledger-entry.mapper';
import { WalletLedgerEntryOrmEntity } from './wallet-ledger-entry.orm-entity';

@Injectable()
export class WalletLedgerEntryRepositoryMikroOrm implements WalletLedgerEntryRepository {
  // Sem await de propósito: em.persist() só registra no Identity Map, não
  // faz I/O (o INSERT de verdade só acontece no flush implícito de
  // em.transactional() no use case). `async` fica só pra bater com a
  // assinatura do port.
  save(entry: WalletLedgerEntry, em: EntityManager): Promise<void> {
    em.persist(WalletLedgerEntryMapper.toNewOrmEntity(entry));
    return Promise.resolve();
  }

  async findByTransactionId(
    transactionId: string,
    em: EntityManager,
  ): Promise<WalletLedgerEntry | null> {
    const row = await em.findOne(WalletLedgerEntryOrmEntity, { transactionId });
    return row ? WalletLedgerEntryMapper.toDomain(row) : null;
  }

  async findPage(
    walletId: string,
    options: { cursor?: string; limit: number },
    em: EntityManager,
  ): Promise<LedgerPage> {
    const where = options.cursor ? { walletId, id: { $lt: options.cursor } } : { walletId };

    // Busca um a mais que o limite pra saber se tem próxima página, sem
    // um COUNT(*) separado.
    const rows = await em.find(WalletLedgerEntryOrmEntity, where, {
      orderBy: { id: 'desc' },
      limit: options.limit + 1,
    });

    const hasMore = rows.length > options.limit;
    const page = hasMore ? rows.slice(0, options.limit) : rows;
    const lastRow = page[page.length - 1];

    return {
      entries: page.map((row) => WalletLedgerEntryMapper.toDomain(row)),
      nextCursor: hasMore && lastRow ? lastRow.id : undefined,
    };
  }

  async findAllByWalletId(walletId: string, em: EntityManager): Promise<WalletLedgerEntry[]> {
    const rows = await em.find(
      WalletLedgerEntryOrmEntity,
      { walletId },
      { orderBy: { id: 'asc' } },
    );
    return rows.map((row) => WalletLedgerEntryMapper.toDomain(row));
  }
}
