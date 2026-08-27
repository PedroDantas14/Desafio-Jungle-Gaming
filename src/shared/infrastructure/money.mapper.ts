import { Money } from '../domain/money';
import { MoneyEmbeddable } from './money.orm-entity';

export function toMoneyEmbeddable(money: Money): MoneyEmbeddable {
  const embeddable = new MoneyEmbeddable();
  embeddable.minorUnits = money.toMinorUnits();
  embeddable.currency = money.currencyCode;
  return embeddable;
}

/**
 * `BigInt(...)` protege contra o driver eventualmente devolver a coluna
 * `bigint` como string em vez de bigint nativo — comportamento que
 * validamos empiricamente contra o Postgres real, não por suposição.
 */
export function fromMoneyEmbeddable(embeddable: MoneyEmbeddable): Money {
  return Money.fromMinorUnits(BigInt(embeddable.minorUnits), embeddable.currency);
}
