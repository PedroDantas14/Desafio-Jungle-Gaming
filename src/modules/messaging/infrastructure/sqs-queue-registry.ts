import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  QueueDoesNotExist,
  SQSClient,
} from '@aws-sdk/client-sqs';

/** Filas conhecidas — `wagerTransactions*` batem com a seção 10 do desafio. */
export const QUEUE_NAMES = {
  wagerTransactionsInput: 'wager-transactions.fifo',
  wagerTransactionsDlq: 'wager-transactions-dlq.fifo',
  integrationEvents: 'integration-events.fifo',
} as const;

export type QueueKey = keyof typeof QUEUE_NAMES;

/**
 * Garante que as filas existem (idempotente: `GetQueueUrl` primeiro,
 * `CreateQueue` só se não existir) e mantém as URLs resolvidas em cache
 * — evita round trip de resolução de URL a cada publish/receive.
 *
 * A DLQ é criada antes da fila principal porque a fila principal
 * referencia o ARN dela na redrive policy (seção 10: respeitar limite de
 * tentativas antes de enviar pra DLQ).
 */
@Injectable()
export class SqsQueueRegistry implements OnModuleInit {
  private readonly logger = new Logger(SqsQueueRegistry.name);
  private readonly urls = new Map<QueueKey, string>();

  constructor(private readonly client: SQSClient) {}

  async onModuleInit(): Promise<void> {
    const dlqUrl = await this.ensureQueue('wagerTransactionsDlq');
    const dlqArn = await this.resolveArn(dlqUrl);

    await this.ensureQueue('wagerTransactionsInput', {
      RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: '5' }),
    });
    await this.ensureQueue('integrationEvents');
  }

  urlFor(key: QueueKey): string {
    const url = this.urls.get(key);
    if (!url) {
      throw new Error(
        `Queue "${key}" was not initialized yet — SqsQueueRegistry.onModuleInit() didn't run.`,
      );
    }
    return url;
  }

  private async ensureQueue(
    key: QueueKey,
    attributes: Record<string, string> = {},
  ): Promise<string> {
    const name = QUEUE_NAMES[key];

    try {
      const { QueueUrl } = await this.client.send(new GetQueueUrlCommand({ QueueName: name }));
      if (QueueUrl) {
        this.urls.set(key, QueueUrl);
        return QueueUrl;
      }
    } catch (error) {
      if (!(error instanceof QueueDoesNotExist)) {
        throw error;
      }
    }

    const { QueueUrl } = await this.client.send(
      new CreateQueueCommand({
        QueueName: name,
        Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'true', ...attributes },
      }),
    );
    if (!QueueUrl) {
      throw new Error(`Failed to create queue "${name}".`);
    }

    this.urls.set(key, QueueUrl);
    this.logger.log(`Queue "${name}" ready at ${QueueUrl}`);
    return QueueUrl;
  }

  private async resolveArn(queueUrl: string): Promise<string> {
    const { Attributes } = await this.client.send(
      new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['QueueArn'] }),
    );
    const arn = Attributes?.QueueArn;
    if (!arn) {
      throw new Error(`Could not resolve ARN for queue at ${queueUrl}.`);
    }
    return arn;
  }
}
