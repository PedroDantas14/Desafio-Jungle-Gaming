import { Injectable } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { WalletRepository } from '../application/ports/wallet.repository';
import { Wallet } from '../domain/wallet';
import { WalletMapper } from './wallet.mapper';
import { WalletOrmEntity } from './wallet.orm-entity';

@Injectable()
export class WalletRepositoryMikroOrm implements WalletRepository {
  async findById(id: string, em: EntityManager): Promise<Wallet | null> {
    const row = await em.findOne(WalletOrmEntity, { id });
    return row ? WalletMapper.toDomain(row) : null;
  }

  async findByIdForUpdate(id: string, em: EntityManager): Promise<Wallet | null> {
    const row = await em.findOne(WalletOrmEntity, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
    return row ? WalletMapper.toDomain(row) : null;
  }

  async findByPlayerAndCurrency(
    playerId: string,
    currency: string,
    em: EntityManager,
  ): Promise<Wallet | null> {
    const row = await em.findOne(WalletOrmEntity, { playerId, balance: { currency } });
    return row ? WalletMapper.toDomain(row) : null;
  }

  async save(wallet: Wallet, em: EntityManager): Promise<void> {
    const now = new Date();
    // Dentro da mesma transação/fork, isso não gera round trip extra — o
    // Identity Map do MikroORM já devolve a instância carregada por
    // findByIdForUpdate() sem reconsultar o banco.
    const existing = await em.findOne(WalletOrmEntity, { id: wallet.id });

    if (existing) {
      WalletMapper.applyToExistingOrmEntity(wallet, existing, now);
    } else {
      em.persist(WalletMapper.toNewOrmEntity(wallet, now));
    }
  }
}
