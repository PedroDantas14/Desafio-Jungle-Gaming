import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Métricas mínimas exigidas pela seção 12 do desafio: transações por
 * status, duplicatas identificadas (replay de idempotência), retries de
 * referência pendente, mensagens direcionadas à DLQ, disputas de lock,
 * atraso da outbox e tempo de processamento fim-a-fim. Expostas em
 * `GET /metrics` (formato Prometheus) via `MetricsController`.
 *
 * `Registry` PRÓPRIO por instância (não o `register` default global do
 * prom-client) — cada `new MetricsService()` (produção: 1 por processo
 * via DI; testes: pode ser instanciada mais de uma vez no mesmo processo
 * `bun test`) tem seu próprio namespace de métricas, sem colidir com
 * "metric already registered" entre instâncias.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  /** Transações finalizadas, por status final e kind (contador cumulativo). */
  readonly wagerTransactionsTotal = new Counter({
    name: 'wager_transactions_total',
    help: 'Wager transactions finalized, by final status and kind.',
    labelNames: ['status', 'kind'] as const,
    registers: [this.registry],
  });

  /** Regra 7 (seção 7): replay de uma idempotencyKey já processada. */
  readonly wagerTransactionDuplicatesTotal = new Counter({
    name: 'wager_transaction_duplicates_total',
    help: 'Idempotent replays detected (same idempotencyKey processed again).',
    registers: [this.registry],
  });

  /** Ciclos do PendingReferenceReprocessorWorker (seção 7.1), por desfecho. */
  readonly pendingReferenceOutcomesTotal = new Counter({
    name: 'pending_reference_outcomes_total',
    help: 'PendingReference reprocessing attempts, by outcome.',
    labelNames: ['outcome'] as const, // resolved | still_pending | expired
    registers: [this.registry],
  });

  /** Amostrado periodicamente pelo DlqDepthSampler — a DLQ em si é gerida pela redrive policy da fila, não por este app. */
  readonly dlqMessagesGauge = new Gauge({
    name: 'sqs_dlq_messages',
    help: 'Approximate number of messages currently in the wager-transactions DLQ.',
    registers: [this.registry],
  });

  /** Tempo pra adquirir o `SELECT ... FOR UPDATE` na linha da wallet — sinal direto de "hot wallet" / disputa de lock (seção 8). */
  readonly walletLockWaitSeconds = new Histogram({
    name: 'wallet_lock_wait_seconds',
    help: 'Time spent acquiring the wallet row lock (SELECT ... FOR UPDATE).',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [this.registry],
  });

  /** Do enqueue no outbox até o publish confirmado no SQS (seção 11). */
  readonly outboxLagSeconds = new Histogram({
    name: 'outbox_lag_seconds',
    help: 'Time between an event being enqueued in the outbox and successfully published to SQS.',
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [this.registry],
  });

  /** Da entrada no use case (lock incluso) até a transação persistida e os eventos enfileirados. */
  readonly wagerTransactionProcessingSeconds = new Histogram({
    name: 'wager_transaction_processing_seconds',
    help: 'End-to-end time to process a wager transaction request.',
    buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2],
    registers: [this.registry],
  });

  /** Seção 9: "divergências não são corrigidas silenciosamente — devem ser logadas, contabilizadas em métrica e sinalizadas na resposta." */
  readonly walletReconciliationDivergencesTotal = new Counter({
    name: 'wallet_reconciliation_divergences_total',
    help: 'Reconciliations where the stored balance diverged from the balance recalculated from the ledger.',
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  async metrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
