import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { SQSClient } from '@aws-sdk/client-sqs';
import mikroOrmConfig from '../../../config/mikro-orm.config';
import { MetricsService } from '../../../shared/infrastructure/metrics.service';
import { Uuidv7IdGenerator } from '../../../shared/infrastructure/uuidv7-id-generator';
import { CreateWalletUseCase } from '../../wallet/application/create-wallet.use-case';
import { WalletLedgerEntryRepositoryMikroOrm } from '../../wallet/infrastructure/wallet-ledger-entry.repository.mikro-orm';
import { WalletRepositoryMikroOrm } from '../../wallet/infrastructure/wallet.repository.mikro-orm';
import { ProcessWagerTransactionUseCase } from '../../wagering/application/process-wager-transaction.use-case';
import { WagerTransactionKind } from '../../wagering/domain/wager-transaction';
import { WagerTransactionRepositoryMikroOrm } from '../../wagering/infrastructure/wager-transaction.repository.mikro-orm';
import { OutboxMessageOrmEntity } from './outbox-message.orm-entity';
import { OutboxMessageRepositoryMikroOrm } from './outbox-message.repository.mikro-orm';
import { OutboxPublisherWorker } from './outbox-publisher.worker';
import { SqsQueueRegistry } from './sqs-queue-registry';

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
 * Teste de integração de verdade: Postgres + LocalStack (SQS) reais.
 * Exige `docker compose up -d postgres localstack` rodando.
 */
describe('OutboxPublisherWorker — integração (Postgres + LocalStack reais)', () => {
  let orm: MikroORM;
  let sqsClient: SQSClient;
  let queues: SqsQueueRegistry;
  let createWalletUseCase: CreateWalletUseCase;
  let processWagerTransactionUseCase: ProcessWagerTransactionUseCase;
  let outboxMessageRepository: OutboxMessageRepositoryMikroOrm;
  let runId: string;

  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    sqsClient = sqsClientFromEnv();
    queues = new SqsQueueRegistry(sqsClient);
    await queues.onModuleInit();
    runId = crypto.randomUUID();

    // O outbox não é resetado entre execuções da suíte (mesmo motivo do
    // `runId` nos outros arquivos) — outros arquivos de teste de
    // integração enfileiram MUITAS mensagens mas nunca rodam um
    // publisher pra drenar. Sem esvaziar esse backlog global primeiro,
    // `claimDue()` (que não é escopado por wallet) pode devolver linhas
    // de execuções anteriores em vez das deste teste, e comparações
    // exatas de contagem ficam não-determinísticas. Drena tudo uma vez,
    // no início da suíte, com um repositório/worker avulsos.
    const drainWorker = new OutboxPublisherWorker(
      orm.em,
      new OutboxMessageRepositoryMikroOrm(),
      sqsClient,
      queues,
      new MetricsService(),
    );
    let drained = 0;
    do {
      drained = await drainWorker.publishBatch(200);
    } while (drained > 0);
  }, 30_000);

  afterAll(async () => {
    sqsClient.destroy();
    await orm.close();
  });

  beforeEach(() => {
    const walletRepository = new WalletRepositoryMikroOrm();
    const walletLedgerEntryRepository = new WalletLedgerEntryRepositoryMikroOrm();
    const wagerTransactionRepository = new WagerTransactionRepositoryMikroOrm();
    outboxMessageRepository = new OutboxMessageRepositoryMikroOrm();
    const idGenerator = new Uuidv7IdGenerator();

    createWalletUseCase = new CreateWalletUseCase(orm.em, walletRepository, idGenerator);
    processWagerTransactionUseCase = new ProcessWagerTransactionUseCase(
      orm.em,
      walletRepository,
      walletLedgerEntryRepository,
      wagerTransactionRepository,
      outboxMessageRepository,
      idGenerator,
      new MetricsService(),
    );
  });

  function buildWorker(): OutboxPublisherWorker {
    return new OutboxPublisherWorker(
      orm.em,
      outboxMessageRepository,
      sqsClient,
      queues,
      new MetricsService(),
    );
  }

  async function openFundedWallet(initialBalance: string): Promise<string> {
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

    return wallet.id;
  }

  // Só conta o que ESTA wallet gerou — o outbox não é resetado entre
  // execuções da suíte (mesmo motivo do `runId` nos outros arquivos), então
  // contar globalmente pegaria o backlog acumulado de outros testes/rodadas.
  async function countOutboxFor(walletId: string, published: boolean): Promise<number> {
    return orm.em
      .fork()
      .count(OutboxMessageOrmEntity, {
        aggregateId: walletId,
        publishedAt: published ? { $ne: null } : null,
      });
  }

  it(
    'seção 13, concorrência #6 + integração "publishers concorrentes sobre a ' +
      'mesma outbox": dois OutboxPublisherWorker rodando ao mesmo tempo — ' +
      'nenhuma mensagem publicada duas vezes, nenhuma esquecida',
    async () => {
      const walletId = await openFundedWallet('1000.00');

      for (let i = 0; i < 10; i++) {
        await processWagerTransactionUseCase.execute({
          providerId: 'integration-test',
          externalTransactionId: `${runId}:outbox-race-${i}`,
          idempotencyKey: `integration-test:${runId}:outbox-race-${i}`,
          payloadHash: 'n/a',
          walletId,
          playerId: crypto.randomUUID(),
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Bet,
          amount: '10.00',
          currency: 'BRL',
        });
      }

      const pendingBefore = await countOutboxFor(walletId, false);
      expect(pendingBefore).toBeGreaterThan(0);

      const worker1 = buildWorker();
      const worker2 = buildWorker();

      // `claimDue()` usa SELECT ... FOR UPDATE SKIP LOCKED (seção 11) —
      // cada worker só reivindica o que o outro não travou primeiro.
      const [published1, published2] = await Promise.all([
        worker1.publishBatch(100),
        worker2.publishBatch(100),
      ]);

      // A soma bate exatamente com o que existia antes — sem
      // sobreposição (nenhum outbox message contado duas vezes) e sem
      // perda (nenhum ficou de fora dos dois lotes).
      expect(published1 + published2).toBe(pendingBefore);

      expect(await countOutboxFor(walletId, false)).toBe(0);
      expect(await countOutboxFor(walletId, true)).toBe(pendingBefore);
    },
    15_000,
  );

  it('retry: falha ao publicar agenda novo attempt com backoff, sem derrubar o resto do lote', async () => {
    const walletId = await openFundedWallet('100.00');
    await processWagerTransactionUseCase.execute({
      providerId: 'integration-test',
      externalTransactionId: `${runId}:outbox-retry`,
      idempotencyKey: `integration-test:${runId}:outbox-retry`,
      payloadHash: 'n/a',
      walletId,
      playerId: crypto.randomUUID(),
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      amount: '10.00',
      currency: 'BRL',
    });

    const pendingBefore = await countOutboxFor(walletId, false);
    expect(pendingBefore).toBeGreaterThan(0);

    // Fake mínimo do registro de filas apontando pra uma URL que não
    // existe — toda tentativa de `SendMessageCommand` falha, sem precisar
    // derrubar o LocalStack pra simular isso. Só implementa o método que
    // o worker de fato usa (`urlFor`).
    const brokenQueues = {
      urlFor: () => `${process.env.AWS_ENDPOINT}/000000000000/queue-that-does-not-exist.fifo`,
    } as unknown as SqsQueueRegistry;
    const brokenWorker = new OutboxPublisherWorker(
      orm.em,
      outboxMessageRepository,
      sqsClient,
      brokenQueues,
      new MetricsService(),
    );

    const published = await brokenWorker.publishBatch(100);
    expect(published).toBe(0);

    // Nada foi marcado como publicado; continua pendente, pronto pro
    // próximo attempt (scheduleRetry já testado a nível de domínio em
    // outbox-message.test.ts — aqui só provamos que o worker chama isso
    // e não perde a mensagem nem quebra o lote).
    expect(await countOutboxFor(walletId, false)).toBe(pendingBefore);
    expect(await countOutboxFor(walletId, true)).toBe(0);
  });
});
