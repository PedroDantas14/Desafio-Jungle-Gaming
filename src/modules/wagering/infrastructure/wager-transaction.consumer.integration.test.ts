import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import mikroOrmConfig from '../../../config/mikro-orm.config';
import { MetricsService } from '../../../shared/infrastructure/metrics.service';
import { Uuidv7IdGenerator } from '../../../shared/infrastructure/uuidv7-id-generator';
import { InboxMessageRepositoryMikroOrm } from '../../messaging/infrastructure/inbox-message.repository.mikro-orm';
import { OutboxMessageRepositoryMikroOrm } from '../../messaging/infrastructure/outbox-message.repository.mikro-orm';
import { SqsQueueRegistry } from '../../messaging/infrastructure/sqs-queue-registry';
import { CreateWalletUseCase } from '../../wallet/application/create-wallet.use-case';
import { WalletLedgerEntryOrmEntity } from '../../wallet/infrastructure/wallet-ledger-entry.orm-entity';
import { WalletLedgerEntryRepositoryMikroOrm } from '../../wallet/infrastructure/wallet-ledger-entry.repository.mikro-orm';
import { WalletRepositoryMikroOrm } from '../../wallet/infrastructure/wallet.repository.mikro-orm';
import { ProcessWagerTransactionUseCase } from '../application/process-wager-transaction.use-case';
import { WagerTransactionKind, WagerTransactionStatus } from '../domain/wager-transaction';
import { WagerTransactionRepositoryMikroOrm } from './wager-transaction.repository.mikro-orm';
import { WagerTransactionConsumer } from './wager-transaction.consumer';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sqsClientFromEnv(): SQSClient {
  return new SQSClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT || undefined,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    },
  });
}

/**
 * Proxy que faz o PRIMEIRO `DeleteMessageCommand` falhar e deixa tudo o
 * resto passar direto pro client real — simula o processo morrendo bem
 * depois do commit da transação e antes do ack (seção 13, concorrência
 * #5: "worker morto depois do commit e antes do ack"). Não é um mock da
 * infra inteira: só o `send()` de UM comando específico é interceptado,
 * tudo o resto (receive, delete de verdade na segunda vez) bate no
 * LocalStack de verdade.
 */
class DeleteOnceFailingSqsClient {
  private failed = false;

  constructor(private readonly real: SQSClient) {}

  async send(command: unknown): Promise<unknown> {
    if (command instanceof DeleteMessageCommand && !this.failed) {
      this.failed = true;
      throw new Error('simulated crash right before ack');
    }
    return this.real.send(command as never);
  }
}

/**
 * Proxy que faz TODO `DeleteMessageCommand` falhar (nunca confirma) —
 * usado só pra provar a DLQ (seção 13, integração "retry e DLQ"): sem
 * ack nenhum, o SQS reentrega até esgotar `maxReceiveCount` (5, ver
 * `SqsQueueRegistry`) e move sozinho pra `wager-transactions-dlq.fifo`
 * via redrive policy — este código nunca implementa DLQ, só nunca apaga.
 */
class AlwaysFailingDeleteSqsClient {
  constructor(private readonly real: SQSClient) {}

  async send(command: unknown): Promise<unknown> {
    if (command instanceof DeleteMessageCommand) {
      throw new Error('simulated permanent ack failure');
    }
    return this.real.send(command as never);
  }
}

/**
 * Teste de integração de verdade: Postgres + LocalStack (SQS) reais —
 * mensagens de verdade entram na fila `wager-transactions.fifo` e são
 * consumidas pelo `WagerTransactionConsumer` real, não um fake em memória.
 *
 * Exige `docker compose up -d postgres localstack` rodando. Roda junto
 * com o resto de `bun run test:integration`.
 */
describe('WagerTransactionConsumer — integração (Postgres + LocalStack reais)', () => {
  let orm: MikroORM;
  let sqsClient: SQSClient;
  let queues: SqsQueueRegistry;
  let createWalletUseCase: CreateWalletUseCase;
  let processWagerTransactionUseCase: ProcessWagerTransactionUseCase;
  let walletRepository: WalletRepositoryMikroOrm;
  let wagerTransactionRepository: WagerTransactionRepositoryMikroOrm;
  let inboxMessageRepository: InboxMessageRepositoryMikroOrm;
  let metrics: MetricsService;
  let runId: string;

  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    sqsClient = sqsClientFromEnv();
    queues = new SqsQueueRegistry(sqsClient);
    await queues.onModuleInit();
    runId = crypto.randomUUID();
  });

  afterAll(async () => {
    sqsClient.destroy();
    await orm.close();
  });

  beforeEach(() => {
    walletRepository = new WalletRepositoryMikroOrm();
    const walletLedgerEntryRepository = new WalletLedgerEntryRepositoryMikroOrm();
    wagerTransactionRepository = new WagerTransactionRepositoryMikroOrm();
    const outboxMessageRepository = new OutboxMessageRepositoryMikroOrm();
    inboxMessageRepository = new InboxMessageRepositoryMikroOrm();
    const idGenerator = new Uuidv7IdGenerator();
    metrics = new MetricsService();

    createWalletUseCase = new CreateWalletUseCase(orm.em, walletRepository, idGenerator);
    processWagerTransactionUseCase = new ProcessWagerTransactionUseCase(
      orm.em,
      walletRepository,
      walletLedgerEntryRepository,
      wagerTransactionRepository,
      outboxMessageRepository,
      idGenerator,
      metrics,
    );
  });

  function buildConsumer(client: SQSClient): WagerTransactionConsumer {
    return new WagerTransactionConsumer(
      orm.em,
      client,
      queues,
      inboxMessageRepository,
      processWagerTransactionUseCase,
      metrics,
    );
  }

  async function openFundedWallet(initialBalance: string): Promise<{
    walletId: string;
    playerId: string;
  }> {
    const wallet = await createWalletUseCase.execute({
      playerId: crypto.randomUUID(),
      currency: 'BRL',
    });

    await processWagerTransactionUseCase.execute({
      providerId: 'integration-test',
      externalTransactionId: `opening-${wallet.id}`,
      idempotencyKey: `integration-test:opening-${wallet.id}`,
      payloadHash: 'n/a',
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: 'n/a',
      gameId: 'n/a',
      kind: WagerTransactionKind.Opening,
      amount: initialBalance,
      currency: 'BRL',
    });

    return { walletId: wallet.id, playerId: wallet.playerId };
  }

  async function loadWallet(walletId: string) {
    return walletRepository.findById(walletId, orm.em.fork());
  }

  async function countDebits(walletId: string): Promise<number> {
    return orm.em.fork().count(WalletLedgerEntryOrmEntity, { walletId, direction: 'DEBIT' });
  }

  interface SendWagerMessageParams {
    walletId: string;
    playerId: string;
    externalTransactionId: string;
    kind: WagerTransactionKind;
    amount: string;
    idempotencyKey?: string;
    referenceExternalTransactionId?: string;
  }

  async function sendWagerMessage(params: SendWagerMessageParams): Promise<void> {
    const externalTransactionId = `${runId}:${params.externalTransactionId}`;
    const body = JSON.stringify({
      messageId: crypto.randomUUID(),
      type: 'WagerTransactionRequested',
      occurredAt: new Date().toISOString(),
      data: {
        providerId: 'integration-test',
        externalTransactionId,
        idempotencyKey: params.idempotencyKey ?? `integration-test:${externalTransactionId}`,
        playerId: params.playerId,
        walletId: params.walletId,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: params.kind,
        money: { amount: params.amount, currency: 'BRL' },
        referenceExternalTransactionId: params.referenceExternalTransactionId
          ? `${runId}:${params.referenceExternalTransactionId}`
          : undefined,
      },
    });

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queues.urlFor('wagerTransactionsInput'),
        MessageBody: body,
        MessageGroupId: params.walletId,
        MessageDeduplicationId: crypto.randomUUID(),
      }),
    );
  }

  it('processa um BET recebido via SQS de ponta a ponta (não só via use case direto)', async () => {
    const { walletId, playerId } = await openFundedWallet('100.00');

    await sendWagerMessage({
      walletId,
      playerId,
      externalTransactionId: 'consumer-happy-bet',
      kind: WagerTransactionKind.Bet,
      amount: '30.00',
    });

    const consumer = buildConsumer(sqsClient);
    const received = await consumer.pollOnce();
    expect(received).toBeGreaterThan(0);

    expect((await loadWallet(walletId))?.currentBalance.toString()).toBe('70.00');
    expect(await countDebits(walletId)).toBe(1);
  });

  it(
    'seção 13, concorrência #5 + integração "inbox e redelivery": crash simulado ' +
      'depois do commit e antes do ack — SQS reentrega a MESMA mensagem, o inbox ' +
      'impede reaplicar o efeito',
    async () => {
      const { walletId, playerId } = await openFundedWallet('100.00');

      await sendWagerMessage({
        walletId,
        playerId,
        externalTransactionId: 'consumer-crash-before-ack',
        kind: WagerTransactionKind.Bet,
        amount: '30.00',
      });

      // Visibility timeout curto (2s) só pra este teste não precisar
      // esperar os 30s de produção pra provar a redelivery de verdade.
      const flakySqsClient = new DeleteOnceFailingSqsClient(sqsClient);
      const consumer = buildConsumer(flakySqsClient as unknown as SQSClient);

      // 1ª entrega: processa e comita de verdade (debita a wallet), mas o
      // ack (delete) falha — mensagem continua "em voo" até o timeout.
      await consumer.pollOnce(2);
      expect((await loadWallet(walletId))?.currentBalance.toString()).toBe('70.00');

      // Espera o visibility timeout expirar — SQS torna a MESMA mensagem
      // (mesmo MessageId) visível de novo, sem ninguém reenviar nada.
      await sleep(2_500);

      // 2ª entrega (redelivery real, não simulada): o inbox já está
      // `processed` pra essa messageId — processMessage() vira no-op e só
      // confirma o ack, sem debitar de novo.
      const receivedAgain = await consumer.pollOnce(2);
      expect(receivedAgain).toBeGreaterThan(0);

      expect((await loadWallet(walletId))?.currentBalance.toString()).toBe('70.00');
      expect(await countDebits(walletId)).toBe(1);

      const duplicates = await metrics.wagerTransactionDuplicatesTotal.get();
      expect(duplicates.values[0]?.value).toBe(1);

      // A mensagem foi de fato confirmada da segunda vez — nada mais pra
      // receber (prova que não ficou presa em loop de retry indefinido).
      const remaining = await consumer.pollOnce(1);
      expect(remaining).toBe(0);
    },
    // Cada pollOnce() faz long-poll de até 5s (WaitTimeSeconds fixo em
    // produção) — 3 chamadas + os 2.5s de espera pelo visibility timeout
    // passam do timeout padrão de 5s do bun:test.
    20_000,
  );

  it(
    'REFUND/ROLLBACK via SQS (Parte 7 pela fila, não só pelo use case direto): ' +
      'REFUND chega antes do BET referenciado, fica PENDING_REFERENCE, resolve ' +
      'quando o BET chega',
    async () => {
      const { walletId, playerId } = await openFundedWallet('100.00');

      await sendWagerMessage({
        walletId,
        playerId,
        externalTransactionId: 'consumer-refund-early',
        kind: WagerTransactionKind.Refund,
        amount: '30.00',
        referenceExternalTransactionId: 'consumer-bet-late',
      });

      const consumer = buildConsumer(sqsClient);
      await consumer.pollOnce();

      const em = orm.em.fork();
      const pending = await wagerTransactionRepository.findByProviderAndExternalId(
        'integration-test',
        `${runId}:consumer-refund-early`,
        em,
      );
      expect(pending?.status).toBe(WagerTransactionStatus.PendingReference);

      // Agora a referência chega — outra mensagem, mesmo fluxo pela fila.
      await sendWagerMessage({
        walletId,
        playerId,
        externalTransactionId: 'consumer-bet-late',
        kind: WagerTransactionKind.Bet,
        amount: '30.00',
      });
      await consumer.pollOnce();
      expect((await loadWallet(walletId))?.currentBalance.toString()).toBe('70.00');

      // Resolve a pendência (mesmo mecanismo da Parte 7 — worker faria
      // isso sozinho; aqui chamado direto pra não esperar o polling).
      await orm.em.transactional((txEm) =>
        processWagerTransactionUseCase.retryPendingReference(pending!.id, txEm),
      );

      const resolved = await wagerTransactionRepository.findById(pending!.id, orm.em.fork());
      expect(resolved?.status).toBe(WagerTransactionStatus.Processed);
      expect((await loadWallet(walletId))?.currentBalance.toString()).toBe('100.00');
    },
    15_000, // 2x pollOnce(), cada um com long-poll de até 5s.
  );

  it(
    'erro de negócio (DomainError) é confirmado (ack) imediatamente — não fica em retry',
    async () => {
      // walletId inexistente → WalletNotFoundError, um DomainError — o
      // consumer trata como terminal (seção 10: erro de negócio nunca
      // adianta reenviar).
      const bogusWalletId = crypto.randomUUID();

      await sendWagerMessage({
        walletId: bogusWalletId,
        playerId: crypto.randomUUID(),
        externalTransactionId: 'consumer-business-error',
        kind: WagerTransactionKind.Bet,
        amount: '30.00',
      });

      const consumer = buildConsumer(sqsClient);
      const received = await consumer.pollOnce();
      expect(received).toBeGreaterThan(0);

      // Já foi confirmada (deletada) — nada sobra pra reentregar.
      const remaining = await consumer.pollOnce(1);
      expect(remaining).toBe(0);
    },
    15_000, // 2x pollOnce(), cada um com long-poll de até 5s.
  );

  it(
    'seção 13, integração "retry e DLQ": mensagem nunca confirmada esgota ' +
      'maxReceiveCount e é movida pra DLQ pela redrive policy da fila',
    async () => {
      const { walletId, playerId } = await openFundedWallet('100.00');

      await sendWagerMessage({
        walletId,
        playerId,
        externalTransactionId: 'consumer-dlq',
        kind: WagerTransactionKind.Bet,
        amount: '30.00',
      });

      // maxReceiveCount da fila é 5 (SqsQueueRegistry) — nunca confirma,
      // então cada ciclo é uma tentativa nova. Visibility timeout curto
      // (1s) só pra não esperar os 30s de produção entre tentativas.
      const consumer = buildConsumer(
        new AlwaysFailingDeleteSqsClient(sqsClient) as unknown as SQSClient,
      );
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await consumer.pollOnce(1);
        await sleep(1_200);
      }

      // A 6ª tentativa já não deveria mais achar a mensagem na fila
      // principal — o SQS a moveu pra DLQ sozinho antes de reentregar de novo.
      const consumerWithRealAck = buildConsumer(sqsClient);
      const stillInMainQueue = await consumerWithRealAck.pollOnce(1);
      expect(stillInMainQueue).toBe(0);

      const { Messages } = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: queues.urlFor('wagerTransactionsDlq'),
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 3,
        }),
      );
      expect(Messages?.length ?? 0).toBeGreaterThan(0);

      // Limpa a mensagem da DLQ pra não vazar entre execuções da suíte.
      const receiptHandle = Messages?.[0]?.ReceiptHandle;
      if (receiptHandle) {
        await sqsClient.send(
          new DeleteMessageCommand({
            QueueUrl: queues.urlFor('wagerTransactionsDlq'),
            ReceiptHandle: receiptHandle,
          }),
        );
      }
    },
    30_000,
  );
});
