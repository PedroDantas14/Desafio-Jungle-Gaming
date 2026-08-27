import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { Pool } from 'pg';

/**
 * Checagem de conectividade simples via pool `pg` cru — ainda sem ORM.
 * Vai ser substituído por um indicator baseado em MikroORM assim que a
 * camada de persistência (entidades/migrations) for implementada,
 * reaproveitando a conexão da própria aplicação em vez de abrir um
 * segundo pool só pra health check.
 */
@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 3000,
  });

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.pool.query('SELECT 1');
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError(
        'Database check failed',
        this.getStatus(key, false, {
          message: error instanceof Error ? error.message : 'unknown error',
        }),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
