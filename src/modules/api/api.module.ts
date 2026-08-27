import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { WalletController } from '../wallet/interface/wallet.controller';
import { WageringModule } from '../wagering/wagering.module';
import { WageringController } from '../wagering/interface/wagering.controller';

/**
 * Módulo de composição HTTP — importa `WalletModule` e `WageringModule`
 * (que não se importam entre si, sem ciclo) e hospeda os dois
 * controllers. `WalletController` precisa de `ProcessWagerTransactionUseCase`
 * (kind OPENING no `POST /wallets` com `initialBalance`) — se esse
 * controller morasse dentro de `WalletModule`, criaria um ciclo, porque
 * `WageringModule` já importa `WalletModule`.
 */
@Module({
  imports: [WalletModule, WageringModule],
  controllers: [WalletController, WageringController],
})
export class ApiModule {}
