import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  DeleteMessageCommand,
  type Message,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { DomainError } from '../../../shared/domain/domain-error';
import { MetricsService } from '../../../shared/infrastructure/metrics.service';
import { canonicalPayloadHash } from '../../../shared/infrastructure/payload-hash';
import { InboxMessageRepository } from '../../messaging/application/ports/inbox-message.repository';
import { InboxMessage } from '../../messaging/domain/inbox-message';
import { InvalidWagerMessageError } from '../../messaging/domain/messaging.errors';
import { SqsQueueRegistry } from '../../messaging/infrastructure/sqs-queue-registry';
import { ProcessWagerTransactionUseCase } from '../application/process-wager-transaction.use-case';
import type { WagerTransactionKind } from '../domain/wager-transaction';

const CONSUMER_NAME = 'wager-transactions-consumer';

interface WagerTransactionRequestedPayload {
  messageId: string;
  type: string;
  occurredAt: string;
  data: {
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: string;
    money: { amount: string; currency: string };
    /** REFUND/ROLLBACK (Parte 7) — ausente pros demais kinds. */
    referenceExternalTransactionId?: string;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Consumidor de `wager-transactions.fifo` (seção 10). Reusa o mesmo use
 * case da entrada HTTP (`processWithinTransaction`, não `execute()`) —
 * escrita do inbox e processamento da transação ficam na MESMA transação
 * SQL (seção 6.5).
 *
 * DLQ é responsabilidade da fila (redrive policy configurada em
 * `SqsQueueRegistry`), não deste código: nunca apagamos mensagem em erro
 * transitório, o visibility timeout expira e o SQS reentrega sozinho;
 * depois de `maxReceiveCount` tentativas, o próprio SQS move pra DLQ.
 */
@Injectable()
export class WagerTransactionConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WagerTransactionConsumer.name);
  private stopped = false;
  private loopPromise?: Promise<void>;

  constructor(
    private readonly em: EntityManager,
    private readonly sqsClient: SQSClient,
    private readonly queues: SqsQueueRegistry,
    private readonly inboxMessageRepository: InboxMessageRepository,
    private readonly processWagerTransactionUseCase: ProcessWagerTransactionUseCase,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.loopPromise = this.pollLoop();
  }

  async onModuleDestroy(): Promise<void> {
    // Seção 10: em SIGTERM, conclui a mensagem em voo (ou deixa o
    // visibility timeout devolver sozinho) — nunca pega mensagem nova
    // depois disso.
    this.stopped = true;
    await this.loopPromise;
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.pollOnce();
      } catch (error) {
        this.logger.error(
          `Poll cycle failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
        await sleep(2_000);
      }
    }
  }

  /**
   * Um ciclo de long-poll + processamento — chamável isoladamente em
   * testes. `visibilityTimeoutSeconds` só existe pra teste de integração
   * conseguir provar redelivery real (visibility timeout expirando) sem
   * esperar 30s de verdade — mesmo espírito do `batchSize` do
   * `PendingReferenceReprocessorWorker.reprocessBatch()`; parâmetro de
   * método, não de construtor, pra não interferir na resolução de DI do
   * Nest (um `number` sem token não resolveria em produção).
   */
  async pollOnce(visibilityTimeoutSeconds = 30): Promise<number> {
    const { Messages } = await this.sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queues.urlFor('wagerTransactionsInput'),
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: 5,
        VisibilityTimeout: visibilityTimeoutSeconds,
      }),
    );

    if (!Messages || Messages.length === 0) {
      return 0;
    }

    for (const message of Messages) {
      await this.handleMessage(message);
    }
    return Messages.length;
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!message.MessageId || !message.Body || !message.ReceiptHandle) {
      this.logger.warn(
        'Received a malformed SQS message (missing id/body/receiptHandle) — skipping.',
      );
      return;
    }

    try {
      await this.processMessage(message.MessageId, message.Body);
      // Ack só depois do commit (seção 10) — processMessage já commitou
      // dentro da própria transação antes de chegarmos aqui.
      await this.delete(message.ReceiptHandle);
    } catch (error) {
      if (error instanceof DomainError) {
        // Erro de negócio: terminal, reenviar não muda nada — ack e segue.
        this.logger.warn({
          event: 'wager_message_business_error',
          messageId: message.MessageId,
          error: error.message,
        });
        await this.delete(message.ReceiptHandle);
        return;
      }

      // Transitório/desconhecido: NÃO apaga. Visibility timeout expira,
      // SQS reentrega; a redrive policy da fila cuida da DLQ sozinha.
      this.logger.error({
        event: 'wager_message_transient_error',
        messageId: message.MessageId,
        error: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  private async processMessage(messageId: string, body: string): Promise<void> {
    // Parseia primeiro — o hash é sobre o SUBCONJUNTO de campos de
    // negócio (seção 9), nunca sobre o envelope inteiro da mensagem
    // (que carrega `messageId`/`occurredAt`, metadado de transporte).
    // Mesmo algoritmo usado pelo `WageringController` — a mesma operação
    // de negócio produz o mesmo `payloadHash` não importa a porta de
    // entrada.
    const parsed = this.parseMessage(body);
    const payloadHash = canonicalPayloadHash({
      providerId: parsed.data.providerId,
      externalTransactionId: parsed.data.externalTransactionId,
      walletId: parsed.data.walletId,
      playerId: parsed.data.playerId,
      roundId: parsed.data.roundId,
      gameId: parsed.data.gameId,
      kind: parsed.data.kind,
      money: parsed.data.money,
      referenceExternalTransactionId: parsed.data.referenceExternalTransactionId,
    });

    await this.em.transactional(async (em) => {
      const existingInbox = await this.inboxMessageRepository.findByConsumerAndMessageId(
        CONSUMER_NAME,
        messageId,
        em,
      );
      const isRedelivery = existingInbox !== null;
      if (isRedelivery) {
        // Redelivery de uma messageId já vista — concluída (crash entre o
        // commit e o ack, o caso mais comum) ou não (crash no meio do
        // processamento anterior). Dedup no nível de mensagem, eixo
        // diferente do dedup por idempotencyKey dentro do use case, mas a
        // mesma métrica de "duplicata identificada" da seção 12 se
        // aplica — incrementada ANTES do early-return abaixo, senão a
        // sub-casuística mais comum (mensagem já concluída) nunca conta.
        this.metrics.wagerTransactionDuplicatesTotal.inc();
      }

      if (existingInbox?.isProcessed) {
        // Redelivery de uma mensagem já concluída — não reprocessa
        // efeito nenhum, só confirma (ack acontece em handleMessage).
        return;
      }

      // Reusa a linha de inbox se essa messageId já foi recebida mas não
      // concluída (crash no meio da vez anterior) — nunca cria duplicata.
      const inbox =
        existingInbox ??
        InboxMessage.receive({ messageId, consumerName: CONSUMER_NAME, payloadHash });
      await this.inboxMessageRepository.save(inbox, em);

      await this.processWagerTransactionUseCase.processWithinTransaction(
        {
          providerId: parsed.data.providerId,
          externalTransactionId: parsed.data.externalTransactionId,
          idempotencyKey: parsed.data.idempotencyKey,
          payloadHash,
          walletId: parsed.data.walletId,
          playerId: parsed.data.playerId,
          roundId: parsed.data.roundId,
          gameId: parsed.data.gameId,
          kind: parsed.data.kind as WagerTransactionKind,
          amount: parsed.data.money.amount,
          currency: parsed.data.money.currency,
          referenceExternalTransactionId: parsed.data.referenceExternalTransactionId,
          causationId: messageId,
        },
        em,
      );

      inbox.markProcessed();
      await this.inboxMessageRepository.save(inbox, em);
    });
  }

  private parseMessage(body: string): WagerTransactionRequestedPayload {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new InvalidWagerMessageError('body is not valid JSON.');
    }

    if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) {
      throw new InvalidWagerMessageError('missing "data" field.');
    }

    return parsed as WagerTransactionRequestedPayload;
  }

  private async delete(receiptHandle: string): Promise<void> {
    await this.sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: this.queues.urlFor('wagerTransactionsInput'),
        ReceiptHandle: receiptHandle,
      }),
    );
  }
}
