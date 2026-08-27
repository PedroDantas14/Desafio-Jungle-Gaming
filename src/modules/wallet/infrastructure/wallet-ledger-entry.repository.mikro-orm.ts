import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WalletLedgerEntryRepository } from '../application/ports/wallet-ledger-entry.repository';
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
}
