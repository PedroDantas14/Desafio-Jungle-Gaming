import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MetricsService } from '../../shared/infrastructure/metrics.service';

/**
 * `GET /metrics` — formato de exposição do Prometheus (seção 12). Sem
 * autenticação, mesmo padrão dos health checks (seção 9: "health checks
 * não exigem autenticação") — scraping de métricas é tipicamente
 * restrito por rede, não por credencial de aplicação.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async get(@Res({ passthrough: true }) res: Response): Promise<string> {
    res.setHeader('Content-Type', this.metrics.contentType);
    return this.metrics.metrics();
  }
}
