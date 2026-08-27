import { Migration } from '@mikro-orm/migrations';

/**
 * Tabelas de Inbox/Outbox (seção 6.5/11). O `migration:create` original
 * tentou derrubar TODAS as constraints hand-written das migrations
 * anteriores (porque elas não fazem parte do metadata das entidades —
 * trade-off já documentado na migration inicial). Reescrita à mão pra
 * conter só o que é novo de verdade: as duas tabelas + suas constraints.
 */
export class Migration20260827022955 extends Migration {
  override name = 'Migration20260827022955';

  override up(): void {
    this.addSql(
      `create table "inbox_messages" ("consumer_name" text not null, "message_id" text not null, "payload_hash" text not null, "received_at" timestamptz not null, "processed_at" timestamptz null, primary key ("consumer_name", "message_id"));`,
    );

    this.addSql(
      `create table "outbox_messages" ("id" uuid not null, "aggregate_id" uuid not null, "event_type" text not null, "payload" jsonb not null, "occurred_at" timestamptz not null, "attempts" int not null, "next_attempt_at" timestamptz not null, "published_at" timestamptz null, primary key ("id"));`,
    );

    this.addSql(
      `alter table "outbox_messages" add constraint "outbox_messages_attempts_non_negative" check ("attempts" >= 0);`,
    );

    // Índice parcial: só cobre o que o publisher realmente consulta
    // (claimDue) — mensagens ainda não publicadas, ordenadas por
    // próxima tentativa. Fica pequeno e rápido mesmo com a tabela
    // crescendo, porque linhas publicadas saem do índice.
    this.addSql(
      `create index "outbox_messages_due_index" on "outbox_messages" ("next_attempt_at") where "published_at" is null;`,
    );
  }

  override down(): void {
    this.addSql(`drop table if exists "inbox_messages" cascade;`);
    this.addSql(`drop table if exists "outbox_messages" cascade;`);
  }
}
