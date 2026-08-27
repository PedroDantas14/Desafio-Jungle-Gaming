import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../../config/mikro-orm.config';
import { Uuidv7IdGenerator } from '../../../shared/infrastructure/uuidv7-id-generator';
import { CreateWalletUseCase } from '../../wallet/application/create-wallet.use-case';
import { WalletLedgerEntryRepositoryMikroOrm } from '../../wallet/infrastructure/wallet-ledger-entry.repository.mikro-orm';
import { WalletLedgerEntryOrmEntity } from '../../wallet/infrastructure/wallet-ledger-entry.orm-entity';
import { WalletRepositoryMikroOrm } from '../../wallet/infrastructure/wallet.repository.mikro-orm';
import { WagerTransactionKind, WagerTransactionStatus } from '../domain/wager-transaction';
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
    const wagerTransactionRepository = new WagerTransactionRepositoryMikroOrm();
    const idGenerator = new Uuidv7IdGenerator();

    createWalletUseCase = new CreateWalletUseCase(orm.em, walletRepository, idGenerator);
    processWagerTransactionUseCase = new ProcessWagerTransactionUseCase(
      orm.em,
      walletRepository,
      walletLedgerEntryRepository,
      wagerTransactionRepository,
      idGenerator,
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
    };
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
});
