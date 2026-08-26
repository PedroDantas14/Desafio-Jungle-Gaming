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
   * Liveness: only proves the process is up and responding to HTTP.
   * Must never check external dependencies — a flaky DB should not get the
   * process killed by an orchestrator's liveness probe.
   */
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  /**
   * Readiness: proves the instance can actually serve traffic right now.
   * Checks the database connection — will be extended with SQS/LocalStack
   * connectivity once the messaging layer lands.
   */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([() => this.database.isHealthy('database')]);
  }
}
