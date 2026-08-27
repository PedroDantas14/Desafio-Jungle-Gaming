import { Global, Module } from '@nestjs/common';
import { IdGenerator } from './application/id-generator';
import { Uuidv7IdGenerator } from './infrastructure/uuidv7-id-generator';

/**
 * `@Global()` porque `IdGenerator` é usado por use cases de módulos
 * diferentes (wallet, wagering, e o que vier depois) — registrar de novo
 * em cada módulo seria repetição sem ganho nenhum.
 */
@Global()
@Module({
  providers: [{ provide: IdGenerator, useClass: Uuidv7IdGenerator }],
  exports: [IdGenerator],
})
export class SharedModule {}
