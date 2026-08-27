import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { OutboxMessageRepository } from '../application/ports/outbox-message.repository';
import { SqsQueueRegistry } from './sqs-queue-registry';

const POLL_INTERVAL_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Publica mensagens pendentes do outbox no SQS (seção 11), continuamente
 * (`onModuleInit` inicia o loop sozinho — não precisa de gatilho externo).
 * Rodar várias instâncias/processos ao mesmo tempo é seguro — `claimDue()`
 * usa `FOR UPDATE SKIP LOCKED`, então cada uma pega um lote disjunto,
 * nunca o mesmo (seção 11: "múltiplos publishers concorrentes").
 *
 * Trade-off honesto (dual-write inerente a outbox+sistema externo): se o
 * processo morre exatamente entre o `SendMessageCommand` ter sucesso e o
 * commit da transação que marca a mensagem como publicada, a mensagem
 * será reenviada na próxima rodada — duplicação **limitada** (não
 * indefinida, que é o que a seção 11 pede: "não perde nem duplica
 * indefinidamente"). A fila FIFO com `MessageDeduplicationId = eventId`
 * absorve boa parte disso de graça dentro da janela de dedup do SQS.
 */
@Injectable()
export class OutboxPublisherWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherWorker.name);
  private stopped = false;
  private loopPromise?: Promise<void>;

  constructor(
    private readonly em: EntityManager,
    private readonly outboxMessageRepository: OutboxMessageRepository,
    private readonly sqsClient: SQSClient,
    private readonly queues: SqsQueueRegistry,
  ) {}

  onModuleInit(): void {
    this.loopPromise = this.pollLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.loopPromise;
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        const published = await this.publishBatch();
        // Só espera se não achou nada — enquanto tiver fila acumulada,
        // continua drenando sem pausa entre lotes.
        if (published === 0) {
          await sleep(POLL_INTERVAL_MS);
        }
      } catch (error) {
        this.logger.error(
          `Publish cycle failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
        await sleep(POLL_INTERVAL_MS);
      }
    }
  }

  /** Reivindica e publica até `batchSize` mensagens pendentes. Devolve quantas publicou com sucesso. */
  async publishBatch(batchSize = 20): Promise<number> {
    return this.em.transactional(async (em) => {
      const messages = await this.outboxMessageRepository.claimDue(batchSize, em);
      let published = 0;

      for (const message of messages) {
        try {
          await this.sqsClient.send(
            new SendMessageCommand({
              QueueUrl: this.queues.urlFor('integrationEvents'),
              MessageBody: JSON.stringify(message.payload),
              MessageGroupId: message.aggregateId,
              MessageDeduplicationId: message.payload.eventId,
            }),
          );
          message.markPublished();
          published += 1;
        } catch (error) {
          this.logger.error(
            `Failed to publish outbox message "${message.id}" (attempt ${message.attempts + 1}): ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
          message.scheduleRetry();
        }

        await this.outboxMessageRepository.save(message, em);
      }

      return published;
    });
  }
}
