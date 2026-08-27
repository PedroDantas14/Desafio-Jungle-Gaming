import {
  IntegrationEvent,
  type IntegrationEventContext,
} from '../../../../shared/domain/integration-event';
import type { MoneyProps } from '../../../../shared/domain/money';
import type { WagerTransaction, WagerTransactionKind } from '../wager-transaction';

export interface WagerTransactionProcessedData {
  transactionId: string;
  walletId: string;
  providerId: string;
  externalTransactionId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  processedAt: string;
}

/** Qualquer transação aplicada, **incluindo LOSS** (seção 11). */
export class WagerTransactionProcessedEvent extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  static from(params: {
    eventId: string;
    transaction: WagerTransaction;
    ctx: IntegrationEventContext;
    occurredAt?: Date;
  }): WagerTransactionProcessedEvent {
    const processedAt = params.transaction.processedAt ?? params.occurredAt ?? new Date();
    return new WagerTransactionProcessedEvent(
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
        processedAt: processedAt.toISOString(),
      },
      params.ctx.causationId,
    );
  }
}
