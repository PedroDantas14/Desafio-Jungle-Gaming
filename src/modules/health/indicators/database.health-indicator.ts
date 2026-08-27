import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { MikroORM } from '@mikro-orm/postgresql';

/**
 * Checagem de conectividade via `checkConnection()` do MikroORM —
 * reaproveita a mesma conexão/pool da aplicação, registrada pelo
 * `MikroOrmModule` (ver `app.module.ts`), em vez de abrir um pool `pg`
 * cru só pra health check (era assim antes da persistência existir).
 */
@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  constructor(private readonly orm: MikroORM) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const result = await this.orm.checkConnection();

    if (result.ok) {
      return this.getStatus(key, true);
    }

    throw new HealthCheckError(
      'Database check failed',
      this.getStatus(key, false, { message: result.reason }),
    );
  }
}
