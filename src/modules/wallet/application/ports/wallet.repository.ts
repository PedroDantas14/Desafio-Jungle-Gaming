import type { EntityManager } from '@mikro-orm/postgresql';
import { type Wallet } from '../../domain/wallet';

/**
 * Porta pro agregado Wallet. `abstract class`, não `interface` — ver nota
 * em `id-generator.ts` sobre por que isso é necessário pro NestJS
 * resolver a injeção de dependência.
 *
 * O parâmetro `em` (EntityManager do MikroORM) vaza infraestrutura pra
 * dentro do port — trade-off consciente: o use case central
 * (`ProcessWagerTransactionUseCase`) precisa que a leitura com lock, a
 * escrita da wallet, do ledger e da transação aconteçam dentro da MESMA
 * transação SQL, e inventar uma abstração de unit-of-work própria só pra
 * esconder isso adicionaria cerimônia sem ganho real pra um projeto deste
 * tamanho — "simplicidade" também é critério de avaliação (seção 14).
 */
export abstract class WalletRepository {
  /** Leitura simples, sem lock — pra consulta (replay de idempotência, GET /wallets/:id). */
  abstract findById(id: string, em: EntityManager): Promise<Wallet | null>;

  /**
   * `SELECT ... FOR UPDATE` — trava a linha até o fim da transação.
   * Unidade de concorrência é `walletId` (seção 8): qualquer outra
   * transação tentando travar a mesma wallet bloqueia aqui até esta
   * commitar ou dar rollback.
   */
  abstract findByIdForUpdate(id: string, em: EntityManager): Promise<Wallet | null>;

  abstract findByPlayerAndCurrency(
    playerId: string,
    currency: string,
    em: EntityManager,
  ): Promise<Wallet | null>;

  abstract save(wallet: Wallet, em: EntityManager): Promise<void>;
}
