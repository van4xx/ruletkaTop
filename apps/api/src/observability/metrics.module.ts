import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CertExpiryHealth } from './health/cert-expiry.health';
import { MetricsController } from './metrics.controller';
import { METRICS_TOKEN } from './metrics.constants';
import { MetricsTokenGuard } from './metrics-token.guard';
import { MetricsService } from './metrics.service';

/**
 * Prometheus metrics wiring. {@link MetricsService} (the registry + custom
 * metrics) is exported and the module is `@Global`, so feature code can inject
 * it directly — e.g. the matchmaking gateway bumps the socket gauge / matches
 * counter and the notifications service bumps the notifications counter —
 * WITHOUT re-importing this module or coupling to prom-client.
 *
 * The shared ioredis client (used by the queue-depth gauge's pull-style
 * `collect`) is resolved from the global `RedisModule`, so it needs no import
 * here. The OPTIONAL `METRICS_TOKEN` (bearer gate) is bound from config.
 *
 * Entirely independent of Sentry: registering metrics never depends on a DSN,
 * so `/metrics` works whether or not error tracking is enabled.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    MetricsTokenGuard,
    // `CertExpiryHealth` registers a pull-style `ruletka_cert_expiry_days{domain}`
    // gauge on `MetricsService`'s registry at `onModuleInit`. The gauge's
    // `collect` callback re-reads the file dropped by the cert-watch sidecar
    // at every scrape (default `/var/lib/cert-watch/days_left.txt`), so the
    // same `/api/metrics` endpoint already used by Prometheus surfaces
    // certificate-expiry as a first-class metric — no second exporter, no
    // extra port. Wired as a plain provider (not a controller) because its
    // observable contract is the gauge it owns, not any HTTP route.
    CertExpiryHealth,
    {
      // Bind the optional bearer secret so MetricsTokenGuard can inject it.
      // Blank/undefined ⇒ the guard leaves the endpoint open (see its docs).
      provide: METRICS_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService): string | undefined =>
        config.get<string>('METRICS_TOKEN'),
    },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
