import { defineEntity } from '@mikro-orm/postgresql';
import { MoneyEmbeddable } from '../../../shared/infrastructure/money.orm-entity';

/**
 * Linha da tabela `wallets`. Deliberadamente sem relação (`manyToOne`/
 * `oneToMany`) pra WagerTransaction/WalletLedgerEntry — cada aggregate
 * root referencia os outros só por id (FK em nível de schema, adicionada
 * na migration), nunca por navegação de objeto do ORM, preservando o
 * limite de aggregate.
 *
 * As constraints reais (unicidade playerId+currency, saldo nunca
 * negativo) vivem na migration em SQL, não aqui.
 */
export const WalletSchema = defineEntity({
  name: 'Wallet',
  tableName: 'wallets',
  properties: (p) => ({
    id: p.uuid().primary(),
    playerId: p.uuid(),
    balance: p.embedded(MoneyEmbeddable).prefix('balance_'),
    version: p.integer(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  }),
});

export class WalletOrmEntity extends WalletSchema.class {}
WalletSchema.setClass(WalletOrmEntity);
