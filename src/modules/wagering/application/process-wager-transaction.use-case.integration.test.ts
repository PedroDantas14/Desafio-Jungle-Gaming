import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../../config/mikro-orm.config';
import { MetricsService } from '../../../shared/infrastructure/metrics.service';
import { Uuidv7IdGenerator } from '../../../shared/infrastructure/uuidv7-id-generator';
import { OutboxMessageRepositoryMikroOrm } from '../../messaging/infrastructure/outbox-message.repository.mikro-orm';
import { CreateWalletUseCase } from '../../wallet/application/create-wallet.use-case';
import { WalletLedgerEntryRepositoryMikroOrm } from '../../wallet/infrastructure/wallet-ledger-entry.repository.mikro-orm';
import { WalletLedgerEntryOrmEntity } from '../../wallet/infrastructure/wallet-ledger-entry.orm-entity';
import { WalletRepositoryMikroOrm } from '../../wallet/infrastructure/wallet.repository.mikro-orm';
import { WagerTransactionKind, WagerTransactionStatus } from '../domain/wager-transaction';
import { PendingReferenceReprocessorWorker } from '../infrastructure/pending-reference-reprocessor.worker';
import { WagerTransactionRepositoryMikroOrm } from '../infrastructure/wager-transaction.repository.mikro-orm';
import {
  type ProcessWagerTransactionCommand,
  ProcessWagerTransactionUseCase,
} from './process-wager-transaction.use-case';

/**
 * Teste de integração de verdade: Postgres real (via docker compose),
 * `Promise.all` disparando chamadas genuinamente concorrentes — cada
 * `execute()` abre sua própria transação/conexão (MikroORM faz fork
 * interno em `em.transactional()`, confirmado lendo o código-fonte do
 * driver antes de escrever este teste). É isso que prova de verdade que
 * o `SELECT ... FOR UPDATE` evita lost update — não um fake em memória.
 *
 * Exige `docker compose up -d postgres` + `bun run migration:up`
 * rodando. Roda separado da suíte padrão: `bun run test:integration`.
 */
describe('ProcessWagerTransactionUseCase — integração (Postgres real)', () => {
  let orm: MikroORM;
  let createWalletUseCase: CreateWalletUseCase;
  let processWagerTransactionUseCase: ProcessWagerTransactionUseCase;
  let walletRepository: WalletRepositoryMikroOrm;
  let wagerTransactionRepository: WagerTransactionRepositoryMikroOrm;
  let pendingReferenceReprocessorWorker: PendingReferenceReprocessorWorker;
  // O banco não é resetado entre execuções da suíte — sem isso, um
  // externalTransactionId fixo tipo "tx-duplicate" colide com a mesma
  // idempotencyKey de uma rodada anterior, e o teste vira replay de uma
  // wallet completamente diferente (já caiu nessa).
  let runId: string;

  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    runId = crypto.randomUUID();
  });

  afterAll(async () => {
    await orm.close();
  });

  beforeEach(() => {
    // Mesma composição que o WageringModule monta via DI — só sem passar
    // pelo container do Nest, pra manter o teste rápido e direto.
    walletRepository = new WalletRepositoryMikroOrm();
    const walletLedgerEntryRepository = new WalletLedgerEntryRepositoryMikroOrm();
    wagerTransactionRepository = new WagerTransactionRepositoryMikroOrm();
    const outboxMessageRepository = new OutboxMessageRepositoryMikroOrm();
    const idGenerator = new Uuidv7IdGenerator();
    const metrics = new MetricsService();

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
    pendingReferenceReprocessorWorker = new PendingReferenceReprocessorWorker(
      orm.em,
      wagerTransactionRepository,
      processWagerTransactionUseCase,
      metrics,
    );
  });

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

  // MikroORM v7 proíbe usar o EntityManager global raiz direto fora de um
  // contexto (transacional ou fork) — essas queries de verificação
  // pós-condição precisam do próprio fork, não `orm.em`.
  async function loadWallet(walletId: string) {
    return walletRepository.findById(walletId, orm.em.fork());
  }

  async function countDebits(walletId: string): Promise<number> {
    return orm.em.fork().count(WalletLedgerEntryOrmEntity, { walletId, direction: 'DEBIT' });
  }

  function bet(
    walletId: string,
    externalTransactionIdSuffix: string,
    overrides: Partial<ProcessWagerTransactionCommand> = {},
  ): ProcessWagerTransactionCommand {
    const externalTransactionId = `${runId}:${externalTransactionIdSuffix}`;
    return {
      providerId: 'integration-test',
      externalTransactionId,
      idempotencyKey: `integration-test:${externalTransactionId}`,
      payloadHash: 'n/a',
      walletId,
      playerId: crypto.randomUUID(),
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      amount: '80.00',
      currency: 'BRL',
      ...overrides,
    };
  }

  // REFUND/ROLLBACK (regra 2, seção 7): mesmo player/wallet/rodada/moeda/
  // valor da transação referenciada — monta a partir do comando original
  // pra garantir que os dois nunca desalinham.
  function reversal(
    kind: typeof WagerTransactionKind.Refund | typeof WagerTransactionKind.Rollback,
    externalTransactionIdSuffix: string,
    reference: ProcessWagerTransactionCommand,
  ): ProcessWagerTransactionCommand {
    const externalTransactionId = `${runId}:${externalTransactionIdSuffix}`;
    return {
      providerId: reference.providerId,
      externalTransactionId,
      idempotencyKey: `integration-test:${externalTransactionId}`,
      payloadHash: 'n/a',
      walletId: reference.walletId,
      playerId: reference.playerId,
      roundId: reference.roundId,
      gameId: reference.gameId,
      kind,
      amount: reference.amount,
      currency: reference.currency,
      referenceExternalTransactionId: reference.externalTransactionId,
    };
  }

  // Só pra testar o ramo de expiração por TTL do worker (seção 7.1) sem
  // esperar 10 minutos de verdade — MikroORM não expõe um jeito de
  // sobrescrever `createdAt` depois de `create()`, então a única forma
  // honesta é voltar o relógio da linha direto no Postgres.
  async function backdateCreatedAt(transactionId: string, msAgo: number): Promise<void> {
    await orm.em
      .fork()
      .getConnection()
      .execute(
        `update "wager_transactions" set "created_at" = now() - (? * interval '1 millisecond') where "id" = ?`,
        [msAgo, transactionId],
      );
  }

  it(
    'cenário obrigatório (seção 8): duas apostas de 80 sobre 100 disparadas ' +
      'concorrentemente — exatamente uma processa, saldo final 20.00, um único débito',
    async () => {
      const walletId = await openFundedWallet('100.00');

      const [first, second] = await Promise.all([
        processWagerTransactionUseCase.execute(bet(walletId, 'tx-concurrent-a')),
        processWagerTransactionUseCase.execute(bet(walletId, 'tx-concurrent-b')),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual(
        [WagerTransactionStatus.Processed, WagerTransactionStatus.Rejected].sort(),
      );

      const finalWallet = await loadWallet(walletId);
      expect(finalWallet?.currentBalance.toString()).toBe('20.00');
      // currentVersion: 1 (opening) + 1 (o único débito que processou) = 2
      expect(finalWallet?.currentVersion).toBe(2);

      const debits = await countDebits(walletId);
      expect(debits).toBe(1);
    },
  );

  it('5 apostas idênticas de 80 sobre 100, disparadas juntas: só uma processa, nenhum lost update', async () => {
    const walletId = await openFundedWallet('100.00');

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        processWagerTransactionUseCase.execute(bet(walletId, `tx-race-${i}`)),
      ),
    );

    const processedCount = results.filter(
      (r) => r.status === WagerTransactionStatus.Processed,
    ).length;
    const rejectedCount = results.filter(
      (r) => r.status === WagerTransactionStatus.Rejected,
    ).length;
    expect(processedCount).toBe(1);
    expect(rejectedCount).toBe(4);

    const finalWallet = await loadWallet(walletId);
    expect(finalWallet?.currentBalance.toString()).toBe('20.00');

    const debits = await countDebits(walletId);
    expect(debits).toBe(1);
  });

  it('duas idempotencyKeys diferentes, saldo suficiente pras duas: ambas processam', async () => {
    const walletId = await openFundedWallet('200.00');

    const [first, second] = await Promise.all([
      processWagerTransactionUseCase.execute(bet(walletId, 'tx-both-a')),
      processWagerTransactionUseCase.execute(bet(walletId, 'tx-both-b')),
    ]);

    expect(first.status).toBe(WagerTransactionStatus.Processed);
    expect(second.status).toBe(WagerTransactionStatus.Processed);

    const finalWallet = await loadWallet(walletId);
    expect(finalWallet?.currentBalance.toString()).toBe('40.00');
  });

  it('mesma idempotencyKey disparada concorrentemente: só um efeito é aplicado', async () => {
    const walletId = await openFundedWallet('100.00');
    const command = bet(walletId, 'tx-duplicate');

    const results = await Promise.all([
      processWagerTransactionUseCase.execute(command),
      processWagerTransactionUseCase.execute(command),
    ]);

    // As duas chamadas devem concordar no resultado final (mesmo id de
    // transação, mesmo status) — uma pode ou não ser sinalizada como
    // replay dependendo de qual ganhou a corrida pelo insert, mas o
    // efeito no saldo é aplicado uma vez só.
    expect(results[0]?.transactionId).toBe(results[1]?.transactionId);
    expect(results[0]?.status).toBe(results[1]?.status);

    const finalWallet = await loadWallet(walletId);
    expect(finalWallet?.currentBalance.toString()).toBe('20.00');

    const debits = await countDebits(walletId);
    expect(debits).toBe(1);
  });

  describe('REFUND/ROLLBACK e PENDING_REFERENCE (Parte 7) — Postgres real', () => {
    it('REFUND de um BET processado credita de volta o valor exato', async () => {
      const walletId = await openFundedWallet('100.00');
      const betCommand = bet(walletId, 'bet-refund-happy');

      await processWagerTransactionUseCase.execute(betCommand);
      expect((await loadWallet(walletId))?.currentBalance.toString()).toBe('20.00');

      const refundResult = await processWagerTransactionUseCase.execute(
        reversal(WagerTransactionKind.Refund, 'refund-happy', betCommand),
      );

      expect(refundResult.status).toBe(WagerTransactionStatus.Processed);
      expect((await loadWallet(walletId))?.currentBalance.toString()).toBe('100.00');
      // O REFUND é um crédito, não um débito — a contagem de débitos não muda.
      expect(await countDebits(walletId)).toBe(1);
    });

    it('ROLLBACK de um WIN processado debita de volta o valor exato', async () => {
      const walletId = await openFundedWallet('100.00');
      const winCommand = bet(walletId, 'win-rollback-happy', { kind: WagerTransactionKind.Win });

      await processWagerTransactionUseCase.execute(winCommand);
      expect((await loadWallet(walletId))?.currentBalance.toString()).toBe('180.00');

      const rollbackResult = await processWagerTransactionUseCase.execute(
        reversal(WagerTransactionKind.Rollback, 'rollback-happy', winCommand),
      );

      expect(rollbackResult.status).toBe(WagerTransactionStatus.Processed);
      expect((await loadWallet(walletId))?.currentBalance.toString()).toBe('100.00');
    });

    it('REFUND que chega antes do BET fica PENDING_REFERENCE e resolve quando a referência aparece (retryPendingReference)', async () => {
      const walletId = await openFundedWallet('100.00');
      const betCommand = bet(walletId, 'bet-late-arrival');

      const refundResult = await processWagerTransactionUseCase.execute(
        reversal(WagerTransactionKind.Refund, 'refund-early-arrival', betCommand),
      );
      expect(refundResult.status).toBe(WagerTransactionStatus.PendingReference);

      // A referência "aparece" depois.
      await processWagerTransactionUseCase.execute(betCommand);
      expect((await loadWallet(walletId))?.currentBalance.toString()).toBe('20.00');

      await orm.em.transactional((em) =>
        processWagerTransactionUseCase.retryPendingReference(refundResult.transactionId, em),
      );

      const resolved = await wagerTransactionRepository.findById(
        refundResult.transactionId,
        orm.em.fork(),
      );
      expect(resolved?.status).toBe(WagerTransactionStatus.Processed);
      expect((await loadWallet(walletId))?.currentBalance.toString()).toBe('100.00');
    });

    it('PendingReferenceReprocessorWorker.reprocessBatch resolve pendências cuja referência já apareceu', async () => {
      const walletId = await openFundedWallet('100.00');
      const betCommand = bet(walletId, 'bet-worker-happy');

      const refundResult = await processWagerTransactionUseCase.execute(
        reversal(WagerTransactionKind.Refund, 'refund-worker-happy', betCommand),
      );
      expect(refundResult.status).toBe(WagerTransactionStatus.PendingReference);

      await processWagerTransactionUseCase.execute(betCommand);

      await pendingReferenceReprocessorWorker.reprocessBatch(50);

      const resolved = await wagerTransactionRepository.findById(
        refundResult.transactionId,
        orm.em.fork(),
      );
      expect(resolved?.status).toBe(WagerTransactionStatus.Processed);
    });

    it('PendingReferenceReprocessorWorker.reprocessBatch expira PENDING_REFERENCE mais velha que o TTL', async () => {
      const walletId = await openFundedWallet('100.00');
      const neverArrivingBet = bet(walletId, 'bet-never-arrives');

      const refundResult = await processWagerTransactionUseCase.execute(
        reversal(WagerTransactionKind.Refund, 'refund-never-arrives', neverArrivingBet),
      );
      expect(refundResult.status).toBe(WagerTransactionStatus.PendingReference);

      // Volta o relógio da linha 11 minutos — passa do TTL de 10 minutos
      // sem precisar esperar de verdade.
      await backdateCreatedAt(refundResult.transactionId, 11 * 60 * 1_000);

      await pendingReferenceReprocessorWorker.reprocessBatch(50);

      const expired = await wagerTransactionRepository.findById(
        refundResult.transactionId,
        orm.em.fork(),
      );
      expect(expired?.status).toBe(WagerTransactionStatus.Rejected);
      expect(expired?.failureCode).toBe('REFERENCE_NOT_FOUND');
    });
  });
});
