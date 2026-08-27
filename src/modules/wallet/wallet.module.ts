import { Module } from '@nestjs/common';
import { CreateWalletUseCase } from './application/create-wallet.use-case';
import { WalletLedgerEntryRepository } from './application/ports/wallet-ledger-entry.repository';
import { WalletRepository } from './application/ports/wallet.repository';
import { WalletLedgerEntryRepositoryMikroOrm } from './infrastructure/wallet-ledger-entry.repository.mikro-orm';
import { WalletRepositoryMikroOrm } from './infrastructure/wallet.repository.mikro-orm';

@Module({
  providers: [
    CreateWalletUseCase,
    { provide: WalletRepository, useClass: WalletRepositoryMikroOrm },
    { provide: WalletLedgerEntryRepository, useClass: WalletLedgerEntryRepositoryMikroOrm },
  ],
  // Repositórios exportados pra WageringModule injetar — ProcessWagerTransactionUseCase
  // opera em Wallet e WalletLedgerEntry também.
  exports: [CreateWalletUseCase, WalletRepository, WalletLedgerEntryRepository],
})
export class WalletModule {}
