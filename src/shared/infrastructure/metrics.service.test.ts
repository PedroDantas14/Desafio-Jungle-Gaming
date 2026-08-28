import { describe, expect, it } from 'bun:test';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('expõe as métricas no formato de exposição do Prometheus', async () => {
    const metrics = new MetricsService();

    metrics.wagerTransactionsTotal.inc({ status: 'PROCESSED', kind: 'BET' });
    metrics.wagerTransactionDuplicatesTotal.inc();
    metrics.dlqMessagesGauge.set(3);

    const output = await metrics.metrics();

    expect(output).toContain('wager_transactions_total{status="PROCESSED",kind="BET"} 1');
    expect(output).toContain('wager_transaction_duplicates_total 1');
    expect(output).toContain('sqs_dlq_messages 3');
    expect(metrics.contentType).toContain('text/plain');
  });

  it('cada instância tem seu próprio registry — sem "metric already registered" entre instâncias', () => {
    // Regressão: prom-client usa um `register` global por padrão; se
    // `MetricsService` registrasse suas métricas nele, instanciar mais de
    // uma vez (como este arquivo de teste faz, e como o segundo `it()`
    // acima já fez) lançaria "AlreadyRegisteredError" na segunda vez.
    expect(() => new MetricsService()).not.toThrow();
    expect(() => new MetricsService()).not.toThrow();
  });
});
