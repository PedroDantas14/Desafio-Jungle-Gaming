import { InvalidMoneyAmountError } from '../../../shared/domain/money.errors';
import { Money } from '../../../shared/domain/money';
import { InsufficientBalanceError } from './wallet.errors';

export interface CreateWalletParams {
  id: string;
  playerId: string;
  currency: string;
}

export interface WalletProps {
  id: string;
  playerId: string;
  balance: Money;
  version: number;
}

/**
 * Aggregate root. Uma Wallet por combinação player+moeda.
 *
 * `version` existe pra que a camada de persistência (adicionada depois)
 * consiga detectar lost updates sob acesso concorrente — é incrementada
 * aqui a cada mutação bem-sucedida, e só nas bem-sucedidas, então um débito
 * rejeitado nunca avança a versão. A garantia real de concorrência (só uma
 * de duas requisições verdadeiramente simultâneas vencer) é aplicada na
 * camada de banco de dados, não aqui — esta classe só garante que o saldo
 * nunca fica negativo e que o versionamento fica consistente pra qualquer
 * estratégia de lock que a envolva.
 */
export class Wallet {
  private balance: Money;
  private version: number;

  private constructor(
    readonly id: string,
    readonly playerId: string,
    balance: Money,
    version: number,
  ) {
    this.balance = balance;
    this.version = version;
  }

  static create(params: CreateWalletParams): Wallet {
    // Seção 6.2: "version inicia em 1 após a criação e incrementa somente
    // quando o saldo muda" — mesmo sem nenhuma mudança de saldo ainda.
    return new Wallet(params.id, params.playerId, Money.zero(params.currency), 1);
  }

  /** Reidrata a partir do banco — não revalida regra nenhuma, só reconstrói estado já persistido. */
  static rehydrate(props: WalletProps): Wallet {
    return new Wallet(props.id, props.playerId, props.balance, props.version);
  }

  get currentBalance(): Money {
    return this.balance;
  }

  get currentVersion(): number {
    return this.version;
  }

  get currency(): string {
    return this.balance.currencyCode;
  }

  credit(amount: Money): void {
    this.ensurePositiveAmount(amount);
    this.balance = this.balance.add(amount);
    this.version += 1;
  }

  debit(amount: Money): void {
    this.ensurePositiveAmount(amount);
    const nextBalance = this.balance.subtract(amount);
    if (nextBalance.isNegative()) {
      throw new InsufficientBalanceError(this.id, this.balance.toString(), amount.toString());
    }
    this.balance = nextBalance;
    this.version += 1;
  }

  private ensurePositiveAmount(amount: Money): void {
    if (!amount.isPositive()) {
      throw new InvalidMoneyAmountError(amount.toString());
    }
  }
}
