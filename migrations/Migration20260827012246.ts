import { Migration } from '@mikro-orm/migrations';

/**
 * Schema inicial: wallets, wager_transactions, wallet_ledger_entries.
 *
 * As tabelas em si (CREATE TABLE) foram geradas pelo MikroORM a partir das
 * entidades. Tudo abaixo disso — UNIQUE composto, CHECK, FK, índices e o
 * trigger de imutabilidade — foi escrito à mão em SQL puro, deliberadamente
 * fora do metadata das entidades (ver comentário nos *.orm-entity.ts).
 *
 * Trade-off consciente: como essas constraints não são declaradas nas
 * entidades, `mikro-orm migration:create` num diff futuro não as
 * reconhece — revisar manualmente qualquer migration gerada depois desta
 * pra garantir que ela não tenta "corrigir" (remover) o que foi
 * adicionado aqui.
 */
export class Migration20260827012246 extends Migration {
  override name = 'Migration20260827012246';

  override up(): void {
    // ---- CREATE TABLE (gerado a partir das entidades) ----

    this.addSql(
      `create table "wager_transactions" ("id" uuid not null, "provider_id" text not null, "external_transaction_id" text not null, "idempotency_key" text not null, "payload_hash" text not null, "wallet_id" uuid not null, "player_id" uuid not null, "round_id" text not null, "game_id" text not null, "kind" text not null, "money_minor_units" bigint not null, "money_currency" char(3) not null, "reference_external_transaction_id" text null, "reference_transaction_id" uuid null, "status" text not null, "failure_code" text null, "processed_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`,
    );

    this.addSql(
      `create table "wallets" ("id" uuid not null, "player_id" uuid not null, "balance_minor_units" bigint not null, "balance_currency" char(3) not null, "version" int not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`,
    );

    this.addSql(
      `create table "wallet_ledger_entries" ("id" uuid not null, "wallet_id" uuid not null, "transaction_id" uuid not null, "direction" text not null, "money_minor_units" bigint not null, "money_currency" char(3) not null, "balance_before_minor_units" bigint not null, "balance_before_currency" char(3) not null, "balance_after_minor_units" bigint not null, "balance_after_currency" char(3) not null, "created_at" timestamptz not null, primary key ("id"));`,
    );

    // ---- wallets: unicidade + não-negatividade ----

    this.addSql(
      `alter table "wallets" add constraint "wallets_player_currency_unique" unique ("player_id", "balance_currency");`,
    );
    this.addSql(
      `alter table "wallets" add constraint "wallets_balance_non_negative" check ("balance_minor_units" >= 0);`,
    );

    // ---- wager_transactions: idempotência, taxonomia, FKs ----

    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_provider_external_unique" unique ("provider_id", "external_transaction_id");`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key");`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_money_positive" check ("money_minor_units" > 0);`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_kind_check" check ("kind" in ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK'));`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_status_check" check ("status" in ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED'));`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_wallet_fk" foreign key ("wallet_id") references "wallets" ("id");`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_reference_fk" foreign key ("reference_transaction_id") references "wager_transactions" ("id");`,
    );
    this.addSql(`create index "wager_transactions_wallet_id_index" on "wager_transactions" ("wallet_id");`);
    this.addSql(`create index "wager_transactions_status_index" on "wager_transactions" ("status");`);

    // ---- wallet_ledger_entries: no máx. 1 lançamento por wallet+transação, não-negatividade, FKs ----

    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_wallet_transaction_unique" unique ("wallet_id", "transaction_id");`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_money_positive" check ("money_minor_units" > 0);`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_balance_before_non_negative" check ("balance_before_minor_units" >= 0);`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_balance_after_non_negative" check ("balance_after_minor_units" >= 0);`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_direction_check" check ("direction" in ('DEBIT','CREDIT'));`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_wallet_fk" foreign key ("wallet_id") references "wallets" ("id");`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_transaction_fk" foreign key ("transaction_id") references "wager_transactions" ("id");`,
    );
    this.addSql(`create index "wallet_ledger_entries_wallet_id_index" on "wallet_ledger_entries" ("wallet_id");`);

    // ---- wallet_ledger_entries: imutabilidade estrutural (seção 6.4) ----
    // "Sem campos mutáveis e sem métodos de transição — a imutabilidade é
    // estrutural, não uma convenção." Reforçado aqui: UPDATE/DELETE na
    // tabela levanta exceção, não importa quem/como tenta.

    this.addSql(`
      create or replace function wallet_ledger_entries_forbid_mutation() returns trigger as $$
      begin
        raise exception 'wallet_ledger_entries is append-only: % not allowed (id=%)', tg_op, old.id;
      end;
      $$ language plpgsql;
    `);
    this.addSql(`
      create trigger wallet_ledger_entries_immutable
        before update or delete on "wallet_ledger_entries"
        for each row execute function wallet_ledger_entries_forbid_mutation();
    `);
  }

  override down(): void {
    this.addSql(`drop trigger if exists wallet_ledger_entries_immutable on "wallet_ledger_entries";`);
    this.addSql(`drop function if exists wallet_ledger_entries_forbid_mutation();`);

    this.addSql(`drop table if exists "wager_transactions" cascade;`);
    this.addSql(`drop table if exists "wallets" cascade;`);
    this.addSql(`drop table if exists "wallet_ledger_entries" cascade;`);
  }
}
