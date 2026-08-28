import { Global, Module } from '@nestjs/common';
import { IdGenerator } from './application/id-generator';
import { MetricsService } from './infrastructure/metrics.service';
import { Uuidv7IdGenerator } from './infrastructure/uuidv7-id-generator';

/**
 * `@Global()` porque `IdGenerator`/`MetricsService` são usados por use
 * cases e workers de módulos diferentes (wallet, wagering, messaging) —
 * registrar de novo em cada módulo seria repetição sem ganho nenhum.
 */
@Global()
@Module({
  providers: [{ provide: IdGenerator, useClass: Uuidv7IdGenerator }, MetricsService],
  exports: [IdGenerator, MetricsService],
})
export class SharedModule {}
