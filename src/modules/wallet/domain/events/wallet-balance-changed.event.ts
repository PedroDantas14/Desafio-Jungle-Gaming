import {
  IntegrationEvent,
  type IntegrationEventContext,
} from '../../../../shared/domain/integration-event';
import type { MoneyProps } from '../../../../shared/domain/money';
import type { Wallet } from '../wallet';
import type { LedgerDirection, WalletLedgerEntry } from '../wallet-ledger-entry';

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

/**
 * Disparado **só** quando o saldo muda de fato (seção 11) — LOSS e
 * transações rejeitadas nunca geram este evento, porque nunca geram
 * `WalletLedgerEntry`.
 */
export class WalletBalanceChangedEvent extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  static from(params: {
    eventId: string;
    wallet: Wallet;
    entry: WalletLedgerEntry;
    ctx: IntegrationEventContext;
    occurredAt?: Date;
  }): WalletBalanceChangedEvent {
    return new WalletBalanceChangedEvent(
      params.eventId,
      params.wallet.id,
      params.ctx.correlationId,
      params.occurredAt ?? new Date(),
      {
        walletId: params.wallet.id,
        transactionId: params.entry.transactionId,
        direction: params.entry.direction,
        money: params.entry.money.toProps(),
        balanceBefore: params.entry.balanceBefore.toProps(),
        balanceAfter: params.entry.balanceAfter.toProps(),
        walletVersion: params.wallet.currentVersion,
      },
      params.ctx.causationId,
    );
  }
}
