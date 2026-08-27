import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { WagerTransactionRepository } from './application/ports/wager-transaction.repository';
import { ProcessWagerTransactionUseCase } from './application/process-wager-transaction.use-case';
import { WagerTransactionRepositoryMikroOrm } from './infrastructure/wager-transaction.repository.mikro-orm';

@Module({
  imports: [WalletModule],
  providers: [
    ProcessWagerTransactionUseCase,
    { provide: WagerTransactionRepository, useClass: WagerTransactionRepositoryMikroOrm },
  ],
  exports: [ProcessWagerTransactionUseCase],
})
export class WageringModule {}
