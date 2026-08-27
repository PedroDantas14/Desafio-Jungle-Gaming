import { defineEntity } from '@mikro-orm/postgresql';
import { MoneyEmbeddable } from '../../../shared/infrastructure/money.orm-entity';

/**
 * Linha da tabela `wallet_ledger_entries`. `direction` fica como texto
 * livre aqui — a validação dos valores permitidos e a imutabilidade
 * estrutural da linha (sem UPDATE/DELETE) são reforçadas na migration via
 * CHECK constraint e trigger, não no ORM.
 */
export const WalletLedgerEntrySchema = defineEntity({
  name: 'WalletLedgerEntry',
  tableName: 'wallet_ledger_entries',
  properties: (p) => ({
    id: p.uuid().primary(),
    walletId: p.uuid(),
    transactionId: p.uuid(),
    direction: p.text(),
    money: p.embedded(MoneyEmbeddable).prefix('money_'),
    balanceBefore: p.embedded(MoneyEmbeddable).prefix('balance_before_'),
    balanceAfter: p.embedded(MoneyEmbeddable).prefix('balance_after_'),
    createdAt: p.datetime(),
  }),
});

export class WalletLedgerEntryOrmEntity extends WalletLedgerEntrySchema.class {}
WalletLedgerEntrySchema.setClass(WalletLedgerEntryOrmEntity);
