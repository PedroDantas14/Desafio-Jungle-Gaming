import { defineEntity } from '@mikro-orm/postgresql';
import { MoneyEmbeddable } from '../../../shared/infrastructure/money.orm-entity';

/**
 * Linha da tabela `wager_transactions`. `kind`/`status`/`failureCode`
 * ficam como texto livre — a taxonomia de valores permitidos é reforçada
 * por CHECK constraint na migration, e `failureCode` é um union type do
 * domínio (seção 7.2: "a taxonomia é sua"), não um enum fixo.
 */
export const WagerTransactionSchema = defineEntity({
  name: 'WagerTransaction',
  tableName: 'wager_transactions',
  properties: (p) => ({
    id: p.uuid().primary(),
    providerId: p.text(),
    externalTransactionId: p.text(),
    idempotencyKey: p.text(),
    payloadHash: p.text(),
    walletId: p.uuid(),
    playerId: p.uuid(),
    roundId: p.text(),
    gameId: p.text(),
    kind: p.text(),
    money: p.embedded(MoneyEmbeddable).prefix('money_'),
    referenceExternalTransactionId: p.text().nullable(),
    referenceTransactionId: p.uuid().nullable(),
    status: p.text(),
    failureCode: p.text().nullable(),
    processedAt: p.datetime().nullable(),
    createdAt: p.datetime(),
  }),
});

export class WagerTransactionOrmEntity extends WagerTransactionSchema.class {}
WagerTransactionSchema.setClass(WagerTransactionOrmEntity);
