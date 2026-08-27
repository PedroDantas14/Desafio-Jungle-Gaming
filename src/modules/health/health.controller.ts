import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './indicators/database.health-indicator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
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
   * Readiness: prova que a instância consegue de fato servir tráfego agora.
   * Checa a conexão com o banco — vai ser estendida com conectividade
   * SQS/LocalStack assim que a camada de mensageria for implementada.
   */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([() => this.database.isHealthy('database')]);
  }
}
