import { defineEntity } from '@mikro-orm/postgresql';

/**
 * Espelho ORM do value object Money — bigint de centavos + moeda,
 * embutido (via `p.embedded`) como duas colunas com prefixo em cada
 * entidade que guarda um valor monetário. `p.bigint()` tem `mode: 'bigint'`
 * como default — mapeia pra bigint nativo do JS/TS ponta a ponta, nunca
 * number/float (validado empiricamente contra o Postgres real — ver
 * `money.mapper.ts`). As constraints reais (não-negatividade, etc.) vivem
 * na migration, não aqui.
 */
const MoneySchema = defineEntity({
  name: 'Money',
  embeddable: true,
  properties: (p) => ({
    minorUnits: p.bigint(),
    currency: p.character().length(3),
  }),
});

export class MoneyEmbeddable extends MoneySchema.class {}
MoneySchema.setClass(MoneyEmbeddable);
