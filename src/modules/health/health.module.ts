import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { MessagingModule } from '../messaging/messaging.module';
import { HealthController } from './health.controller';
import { DatabaseHealthIndicator } from './indicators/database.health-indicator';
import { SqsHealthIndicator } from './indicators/sqs.health-indicator';
import { MetricsController } from './metrics.controller';

@Module({
  imports: [TerminusModule, MessagingModule],
  controllers: [HealthController, MetricsController],
  providers: [DatabaseHealthIndicator, SqsHealthIndicator],
})
export class HealthModule {}
