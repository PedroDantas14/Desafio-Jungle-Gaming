import {
  IntegrationEvent,
  type IntegrationEventContext,
} from '../../../../shared/domain/integration-event';
import type { WagerTransaction, WagerTransactionKind } from '../wager-transaction';

export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  walletId: string;
  providerId: string;
  externalTransactionId: string;
  kind: WagerTransactionKind;
  referenceExternalTransactionId: string;
}

/**
 * Referência ausente — transação fica em `PendingReference`, aguardando
 * o worker de reprocessamento (seção 7.1). Ainda não disparado por nada
 * na Parte 5 (só BET/WIN/LOSS/OPENING existem até aqui); passa a ser
 * usado quando REFUND/ROLLBACK chegarem (Parte 7).
 */
export class WagerTransactionPendingReferenceEvent extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  static from(params: {
    eventId: string;
    transaction: WagerTransaction;
    ctx: IntegrationEventContext;
    occurredAt?: Date;
  }): WagerTransactionPendingReferenceEvent {
    if (!params.transaction.referenceExternalTransactionId) {
      throw new Error(
        `Cannot build WagerTransactionPendingReferenceEvent for "${params.transaction.id}" without a referenceExternalTransactionId.`,
      );
    }

    return new WagerTransactionPendingReferenceEvent(
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
        referenceExternalTransactionId: params.transaction.referenceExternalTransactionId,
      },
      params.ctx.causationId,
    );
  }
}
