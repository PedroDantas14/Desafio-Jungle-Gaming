import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, type HealthIndicatorResult } from '@nestjs/terminus';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { SqsQueueRegistry } from '../../messaging/infrastructure/sqs-queue-registry';

/**
 * Prova conectividade com o SQS/LocalStack consultando um atributo barato
 * de uma fila já conhecida (`integrationEvents`) — não publica nem
 * consome nada, só confirma que a API responde. Mesmo padrão do
 * `DatabaseHealthIndicator`: reaproveita o client e o registro de filas
 * já montados pela aplicação, sem abrir conexão nova só pro health check.
 */
@Injectable()
export class SqsHealthIndicator extends HealthIndicator {
  constructor(
    private readonly client: SQSClient,
    private readonly queues: SqsQueueRegistry,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.client.send(
        new GetQueueAttributesCommand({
          QueueUrl: this.queues.urlFor('integrationEvents'),
          AttributeNames: ['QueueArn'],
        }),
      );
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError(
        'SQS check failed',
        this.getStatus(key, false, {
          message: error instanceof Error ? error.message : 'unknown error',
        }),
      );
    }
  }
}
