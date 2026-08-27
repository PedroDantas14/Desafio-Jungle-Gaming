import { Module } from '@nestjs/common';
import { SQSClient } from '@aws-sdk/client-sqs';
import { InboxMessageRepository } from './application/ports/inbox-message.repository';
import { OutboxMessageRepository } from './application/ports/outbox-message.repository';
import { InboxMessageRepositoryMikroOrm } from './infrastructure/inbox-message.repository.mikro-orm';
import { OutboxMessageRepositoryMikroOrm } from './infrastructure/outbox-message.repository.mikro-orm';
import { OutboxPublisherWorker } from './infrastructure/outbox-publisher.worker';
import { sqsClientProvider } from './infrastructure/sqs-client.provider';
import { SqsQueueRegistry } from './infrastructure/sqs-queue-registry';

/**
 * Só o que é genérico de mensageria (inbox/outbox, cliente SQS, registro
 * de filas, worker de publicação — que drena o outbox não importa qual
 * domínio gerou o evento). O consumidor de `wager-transactions.fifo` é
 * específico do domínio wagering e mora lá (`WageringModule`), não aqui
 * — evita ciclo de módulos (consumer → ProcessWagerTransactionUseCase →
 * OutboxMessageRepository → MessagingModule → consumer).
 */
@Module({
  providers: [
    sqsClientProvider,
    SqsQueueRegistry,
    { provide: InboxMessageRepository, useClass: InboxMessageRepositoryMikroOrm },
    { provide: OutboxMessageRepository, useClass: OutboxMessageRepositoryMikroOrm },
    OutboxPublisherWorker,
  ],
  exports: [
    SQSClient,
    SqsQueueRegistry,
    InboxMessageRepository,
    OutboxMessageRepository,
    OutboxPublisherWorker,
  ],
})
export class MessagingModule {}
