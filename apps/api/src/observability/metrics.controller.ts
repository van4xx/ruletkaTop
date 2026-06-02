import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import { MetricsTokenGuard } from './metrics-token.guard';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scrape endpoint. Resolves to `GET /<globalPrefix>/metrics`
 * (`/api/metrics` with the default prefix), mirroring how `GET /health` sits
 * under the prefix.
 *
 * - NOT behind the JWT auth guard — Prometheus scrapes with a static credential,
 *   not a user JWT. An OPTIONAL bearer gate ({@link MetricsTokenGuard}, driven by
 *   `METRICS_TOKEN`) protects it when the port is exposed beyond a private net.
 * - `@SkipThrottle()` so frequent scrapes (~every 15s) are never rate-limited by
 *   the global per-IP throttler.
 * - Excluded from Swagger — it is operational plumbing, not part of the API.
 * - Always available, independent of Sentry: metrics are cheap and safe to emit
 *   with error tracking off.
 */
@ApiExcludeController()
@SkipThrottle()
@UseGuards(MetricsTokenGuard)
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  /**
   * Render the current metric snapshot in Prometheus exposition format. We write
   * the response DIRECTLY (no passthrough) so the registry's exact
   * `Content-Type` (`text/plain; version=0.0.4; charset=utf-8`) is sent verbatim
   * — scrapers rely on it. `no-store` is correct for a live scrape (the thin
   * cache middleware in main.ts also stamps it; set here too for clarity).
   */
  @Get()
  async scrape(@Res() res: Response): Promise<void> {
    const body = await this.metrics.render();
    res
      .status(200)
      .set('Content-Type', this.metrics.contentType)
      .set('Cache-Control', 'no-store')
      .send(body);
  }
}
