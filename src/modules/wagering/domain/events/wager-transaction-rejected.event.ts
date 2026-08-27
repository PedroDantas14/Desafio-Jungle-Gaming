import {
  IntegrationEvent,
  type IntegrationEventContext,
} from '../../../../shared/domain/integration-event';
import type { MoneyProps } from '../../../../shared/domain/money';
import type { FailureCode, WagerTransaction, WagerTransactionKind } from '../wager-transaction';

export interface WagerTransactionRejectedData {
  transactionId: string;
  walletId: string;
  providerId: string;
  externalTransactionId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  failureCode: FailureCode;
}

/** Transação rejeitada por regra de negócio (seção 11). */
export class WagerTransactionRejectedEvent extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  static from(params: {
    eventId: string;
    transaction: WagerTransaction;
    ctx: IntegrationEventContext;
    occurredAt?: Date;
  }): WagerTransactionRejectedEvent {
    if (!params.transaction.failureCode) {
      throw new Error(
        `Cannot build WagerTransactionRejectedEvent for "${params.transaction.id}" without a failureCode.`,
      );
    }

    return new WagerTransactionRejectedEvent(
      params.eventId,
      params.transaction.walletId,
      params.ctx.correlationId,
      params.occurredAt ?? new Date(),
      {
        transactionId: params.transaction.id,
        walletId: params.transaction.walletId,
        providerId: params.transaction.providerId,
        externalTransactionId: params.transaction.externalTransactionId,
        kind: params.transaction.kind,
        money: params.transaction.money.toProps(),
        failureCode: params.transaction.failureCode,
      },
      params.ctx.causationId,
    );
  }
}
