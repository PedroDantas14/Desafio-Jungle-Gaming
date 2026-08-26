import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { Pool } from 'pg';

/**
 * Naive connectivity check via a raw `pg` pool — no ORM involved yet.
 * Will be replaced by a MikroORM-backed indicator once the persistence
 * layer (entities/migrations) lands, reusing the app's own connection
 * instead of opening a second pool just for health checks.
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
