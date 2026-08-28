import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from './mikro-orm.config';
import { MetricsService } from '../shared/infrastructure/metrics.service';
import { Uuidv7IdGenerator } from '../shared/infrastructure/uuidv7-id-generator';
import { OutboxMessageRepositoryMikroOrm } from '../modules/messaging/infrastructure/outbox-message.repository.mikro-orm';
import { CreateWalletUseCase } from '../modules/wallet/application/create-wallet.use-case';
import { WalletLedgerEntryRepositoryMikroOrm } from '../modules/wallet/infrastructure/wallet-ledger-entry.repository.mikro-orm';
import { WalletRepositoryMikroOrm } from '../modules/wallet/infrastructure/wallet.repository.mikro-orm';
import { ProcessWagerTransactionUseCase } from '../modules/wagering/application/process-wager-transaction.use-case';
import { WagerTransactionKind } from '../modules/wagering/domain/wager-transaction';
import { WagerTransactionRepositoryMikroOrm } from '../modules/wagering/infrastructure/wager-transaction.repository.mikro-orm';

/**
 * Seção 13, integração "migrations e constraints": prova que as
 * constraints reais (UNIQUE, CHECK, o trigger de imutabilidade do
 * ledger) escritas à mão na migration (não declaradas nas entidades —
 * ver nota no topo de `migrations/Migration*.ts`) estão de fato
 * aplicadas no schema, não só assumidas pelo código de aplicação.
 * Ataca o banco direto via SQL cru, contornando o use case — é assim que
 * se prova que a garantia é do Postgres, não só de disciplina da app.
 *
 * Exige `docker compose up -d postgres` + `bun run migration:up` rodando.
 */
describe('Schema — constraints reais aplicadas pela migration (Postgres real)', () => {
  let orm: MikroORM;
  let createWalletUseCase: CreateWalletUseCase;
  let processWagerTransactionUseCase: ProcessWagerTransactionUseCase;

  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);

    const walletRepository = new WalletRepositoryMikroOrm();
    const walletLedgerEntryRepository = new WalletLedgerEntryRepositoryMikroOrm();
    const wagerTransactionRepository = new WagerTransactionRepositoryMikroOrm();
    const outboxMessageRepository = new OutboxMessageRepositoryMikroOrm();
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

  afterAll(async () => {
    await orm.close();
  });

  async function raw(sql: string, params: unknown[] = []): Promise<unknown> {
    return orm.em.fork().getConnection().execute(sql, params);
  }

  it('wallets_balance_non_negative: UPDATE que deixaria o saldo negativo é rejeitado pelo Postgres', async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: crypto.randomUUID(),
      currency: 'BRL',
    });

    await expect(
      raw('update "wallets" set "balance_minor_units" = -100 where "id" = ?', [wallet.id]),
    ).rejects.toThrow(/balance_non_negative|check constraint/i);
  });

  it('wallets_player_currency_unique: duas wallets pro mesmo player+moeda são rejeitadas pelo Postgres', async () => {
    const playerId = crypto.randomUUID();
    await createWalletUseCase.execute({ playerId, currency: 'BRL' });

    await expect(createWalletUseCase.execute({ playerId, currency: 'BRL' })).rejects.toThrow();
  });

  it('wager_transactions_idempotency_key_unique: INSERT direto duplicando a chave é rejeitado pelo Postgres', async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: crypto.randomUUID(),
      currency: 'BRL',
    });
    await processWagerTransactionUseCase.execute({
      providerId: 'schema-test',
      externalTransactionId: 'opening',
      idempotencyKey: 'schema-test:duplicate-key',
      payloadHash: 'n/a',
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: 'n/a',
      gameId: 'n/a',
      kind: WagerTransactionKind.Opening,
      amount: '10.00',
      currency: 'BRL',
    });

    // INSERT cru — não passa pelo use case (que já barra isso na
    // aplicação), pra provar que o UNIQUE existe no schema em si.
    await expect(
      raw(
        `insert into "wager_transactions"
          ("id", "provider_id", "external_transaction_id", "idempotency_key", "payload_hash",
           "wallet_id", "player_id", "round_id", "game_id", "kind",
           "money_minor_units", "money_currency", "status", "created_at")
         values (?, 'schema-test', 'outra-transacao', 'schema-test:duplicate-key', 'n/a',
                 ?, ?, 'n/a', 'n/a', 'BET', 1000, 'BRL', 'PENDING', now())`,
        [crypto.randomUUID(), wallet.id, wallet.playerId],
      ),
    ).rejects.toThrow(/idempotency_key_unique|unique constraint/i);
  });

  it('wager_transactions_money_positive: INSERT com valor zero/negativo é rejeitado pelo Postgres', async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: crypto.randomUUID(),
      currency: 'BRL',
    });

    await expect(
      raw(
        `insert into "wager_transactions"
          ("id", "provider_id", "external_transaction_id", "idempotency_key", "payload_hash",
           "wallet_id", "player_id", "round_id", "game_id", "kind",
           "money_minor_units", "money_currency", "status", "created_at")
         values (?, 'schema-test', ?, ?, 'n/a', ?, ?, 'n/a', 'n/a', 'BET', 0, 'BRL', 'PENDING', now())`,
        [
          crypto.randomUUID(),
          `zero-money-${crypto.randomUUID()}`,
          `schema-test:zero-money-${crypto.randomUUID()}`,
          wallet.id,
          wallet.playerId,
        ],
      ),
    ).rejects.toThrow(/money_positive|check constraint/i);
  });

  it('wallet_ledger_entries_immutable: UPDATE e DELETE num lançamento existente são rejeitados pelo trigger', async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: crypto.randomUUID(),
      currency: 'BRL',
    });
    await processWagerTransactionUseCase.execute({
      providerId: 'schema-test',
      externalTransactionId: `opening-immutable-${wallet.id}`,
      idempotencyKey: `schema-test:opening-immutable-${wallet.id}`,
      payloadHash: 'n/a',
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: 'n/a',
      gameId: 'n/a',
      kind: WagerTransactionKind.Opening,
      amount: '50.00',
      currency: 'BRL',
    });

    const [entry] = (await raw(
      'select "id" from "wallet_ledger_entries" where "wallet_id" = ? limit 1',
      [wallet.id],
    )) as { id: string }[];
    expect(entry?.id).toBeDefined();

    await expect(
      raw('update "wallet_ledger_entries" set "money_minor_units" = 1 where "id" = ?', [
        entry!.id,
      ]),
    ).rejects.toThrow(/append-only|UPDATE not allowed/i);

    await expect(
      raw('delete from "wallet_ledger_entries" where "id" = ?', [entry!.id]),
    ).rejects.toThrow(/append-only|DELETE not allowed/i);
  });
});
