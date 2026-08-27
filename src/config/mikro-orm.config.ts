import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { WalletOrmEntity } from '../modules/wallet/infrastructure/wallet.orm-entity';
import { WalletLedgerEntryOrmEntity } from '../modules/wallet/infrastructure/wallet-ledger-entry.orm-entity';
import { WagerTransactionOrmEntity } from '../modules/wagering/infrastructure/wager-transaction.orm-entity';
import { InboxMessageOrmEntity } from '../modules/messaging/infrastructure/inbox-message.orm-entity';
import { OutboxMessageOrmEntity } from '../modules/messaging/infrastructure/outbox-message.orm-entity';

export default defineConfig({
  clientUrl: process.env.DATABASE_URL,
  entities: [
    WalletOrmEntity,
    WalletLedgerEntryOrmEntity,
    WagerTransactionOrmEntity,
    InboxMessageOrmEntity,
    OutboxMessageOrmEntity,
  ],
  extensions: [Migrator],
  migrations: {
    path: 'migrations',
    glob: '!(*.d).{js,ts}',
  },
  debug: process.env.NODE_ENV !== 'production',
});
