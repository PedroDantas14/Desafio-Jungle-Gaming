import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { MetricsService } from '../../../shared/infrastructure/metrics.service';
import { SqsQueueRegistry } from './sqs-queue-registry';

const SAMPLE_INTERVAL_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Amostra `ApproximateNumberOfMessages` da DLQ periodicamente e publica
 * como gauge (seção 12: "mensagens direcionadas à DLQ"). A DLQ em si NÃO
 * é consumida por este app — é a redrive policy da fila que move
 * mensagens pra lá sozinha depois de N tentativas (ver `SqsQueueRegistry`
 * e `WagerTransactionConsumer`) — então a única forma de observar o
 * volume sem reimplementar a DLQ é perguntar pro próprio SQS quantas
 * mensagens estão lá agora. Mesmo padrão de loop dos outros workers
 * (`onModuleInit`/`onModuleDestroy`), mas sem backoff — o intervalo é
 * fixo porque isso é amostragem, não trabalho a drenar.
 */
@Injectable()
export class DlqDepthSampler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DlqDepthSampler.name);
  private stopped = false;
  private loopPromise?: Promise<void>;

  constructor(
    private readonly client: SQSClient,
    private readonly queues: SqsQueueRegistry,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.loopPromise = this.loop();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.loopPromise;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.sampleOnce();
      } catch (error) {
        // Esperado logo no boot, antes do SqsQueueRegistry.onModuleInit()
        // criar as filas — o loop se autocorrige na próxima amostra, sem
        // travar o processo.
        this.logger.warn({
          event: 'dlq_depth_sample_failed',
          error: error instanceof Error ? error.message : 'unknown error',
        });
      }
      await sleep(SAMPLE_INTERVAL_MS);
    }
  }

  async sampleOnce(): Promise<void> {
    const { Attributes } = await this.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: this.queues.urlFor('wagerTransactionsDlq'),
        AttributeNames: ['ApproximateNumberOfMessages'],
      }),
    );
    const depth = Number(Attributes?.ApproximateNumberOfMessages ?? 0);
    this.metrics.dlqMessagesGauge.set(depth);
  }
}
