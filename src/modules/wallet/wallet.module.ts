import { Module } from '@nestjs/common';
import { CreateWalletUseCase } from './application/create-wallet.use-case';
import { WalletLedgerEntryRepository } from './application/ports/wallet-ledger-entry.repository';
import { WalletRepository } from './application/ports/wallet.repository';
import { ReconcileWalletUseCase } from './application/reconcile-wallet.use-case';
import { WalletLedgerEntryRepositoryMikroOrm } from './infrastructure/wallet-ledger-entry.repository.mikro-orm';
import { WalletRepositoryMikroOrm } from './infrastructure/wallet.repository.mikro-orm';

@Module({
  providers: [
    CreateWalletUseCase,
    ReconcileWalletUseCase,
    { provide: WalletRepository, useClass: WalletRepositoryMikroOrm },
    { provide: WalletLedgerEntryRepository, useClass: WalletLedgerEntryRepositoryMikroOrm },
  ],
  // Repositórios exportados pra WageringModule (ProcessWagerTransactionUseCase
  // opera em Wallet/WalletLedgerEntry) e pro ApiModule (controllers leem direto).
  exports: [
    CreateWalletUseCase,
    ReconcileWalletUseCase,
    WalletRepository,
    WalletLedgerEntryRepository,
  ],
})
export class WalletModule {}
