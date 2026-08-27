import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import mikroOrmConfig from './config/mikro-orm.config';
import { HealthModule } from './modules/health/health.module';
import { SharedModule } from './shared/shared.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { WageringModule } from './modules/wagering/wagering.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MikroOrmModule.forRoot(mikroOrmConfig),
    SharedModule,
    HealthModule,
    WalletModule,
    WageringModule,
  ],
})
export class AppModule {}
