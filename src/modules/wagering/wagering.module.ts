import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { WalletModule } from '../wallet/wallet.module';
import { WagerTransactionRepository } from './application/ports/wager-transaction.repository';
import { ProcessWagerTransactionUseCase } from './application/process-wager-transaction.use-case';
import { WagerTransactionRepositoryMikroOrm } from './infrastructure/wager-transaction.repository.mikro-orm';
import { WagerTransactionConsumer } from './infrastructure/wager-transaction.consumer';
import { PendingReferenceReprocessorWorker } from './infrastructure/pending-reference-reprocessor.worker';

@Module({
  imports: [WalletModule, MessagingModule],
  providers: [
    ProcessWagerTransactionUseCase,
    { provide: WagerTransactionRepository, useClass: WagerTransactionRepositoryMikroOrm },
    WagerTransactionConsumer,
    PendingReferenceReprocessorWorker,
  ],
  exports: [ProcessWagerTransactionUseCase, WagerTransactionRepository],
})
export class WageringModule {}
