import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './indicators/database.health-indicator';
import { SqsHealthIndicator } from './indicators/sqs.health-indicator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
    private readonly sqs: SqsHealthIndicator,
  ) {}

  /**
   * Liveness: só prova que o processo está de pé e respondendo HTTP.
   * Nunca deve checar dependências externas — um banco instável não pode
   * fazer o orquestrador matar o processo por causa da liveness probe.
   */
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  /**
   * Readiness: prova que a instância consegue de fato servir tráfego agora
   * (seção 12) — checa PostgreSQL e SQS, as duas dependências externas de
   * verdade da aplicação.
   */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.database.isHealthy('database'),
      () => this.sqs.isHealthy('sqs'),
    ]);
  }
}
