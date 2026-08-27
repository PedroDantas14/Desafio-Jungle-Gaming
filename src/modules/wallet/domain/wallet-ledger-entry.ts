import { Money } from '../../../shared/domain/money';
import { InvalidLedgerEntryError } from './wallet.errors';

export enum LedgerDirection {
  Debit = 'DEBIT',
  Credit = 'CREDIT',
}

export interface CreateLedgerEntryParams {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  createdAt?: Date;
}

export interface RehydrateLedgerEntryParams extends CreateLedgerEntryParams {
  balanceAfter: Money;
}

/**
 * Lançamento imutável da trilha de auditoria. "Sem campos mutáveis e sem
 * métodos de transição — a imutabilidade é estrutural, não uma convenção"
 * (seção 6.4 do desafio). Correções acontecem registrando um novo
 * lançamento (REFUND/ROLLBACK), nunca alterando o histórico.
 *
 * `balanceAfter` é sempre derivado de `balanceBefore` + `direction` +
 * `money`: `create()` deriva sozinho, então nunca pode divergir; e
 * `rehydrate()` (reidratação de uma linha do banco numa parte futura)
 * reconfere essa mesma aritmética via `isBalanced()`, então uma linha
 * corrompida é pega em vez de confiada silenciosamente.
 */
export class WalletLedgerEntry {
  private constructor(
    readonly id: string,
    readonly walletId: string,
    readonly transactionId: string,
    readonly direction: LedgerDirection,
    readonly money: Money,
    readonly balanceBefore: Money,
    readonly balanceAfter: Money,
    readonly createdAt: Date,
  ) {
    Object.freeze(this);
  }

  static create(params: CreateLedgerEntryParams): WalletLedgerEntry {
    if (!params.money.isPositive()) {
      throw new InvalidLedgerEntryError('money must be positive — direction carries the sign.');
    }

    const balanceAfter = WalletLedgerEntry.deriveBalanceAfter(params);

    if (balanceAfter.isNegative()) {
      throw new InvalidLedgerEntryError(
        `would leave a negative balance: ${balanceAfter.toString()}.`,
      );
    }

    return new WalletLedgerEntry(
      params.id,
      params.walletId,
      params.transactionId,
      params.direction,
      params.money,
      params.balanceBefore,
      balanceAfter,
      params.createdAt ?? new Date(),
    );
  }

  /** Reidrata uma linha já persistida — reconfere a aritmética, não a re-deriva. */
  static rehydrate(params: RehydrateLedgerEntryParams): WalletLedgerEntry {
    const entry = new WalletLedgerEntry(
      params.id,
      params.walletId,
      params.transactionId,
      params.direction,
      params.money,
      params.balanceBefore,
      params.balanceAfter,
      params.createdAt ?? new Date(),
    );

    if (!entry.isBalanced()) {
      throw new InvalidLedgerEntryError(
        `stored balanceAfter (${params.balanceAfter.toString()}) does not match ` +
          `balanceBefore ${params.balanceBefore.toString()} ${params.direction} ${params.money.toString()}.`,
      );
    }

    return entry;
  }

  /** balanceBefore ± money === balanceAfter. Verificada nas duas factories. */
  isBalanced(): boolean {
    return WalletLedgerEntry.deriveBalanceAfter(this).equals(this.balanceAfter);
  }

  private static deriveBalanceAfter(params: {
    direction: LedgerDirection;
    balanceBefore: Money;
    money: Money;
  }): Money {
    return params.direction === LedgerDirection.Credit
      ? params.balanceBefore.add(params.money)
      : params.balanceBefore.subtract(params.money);
  }
}
