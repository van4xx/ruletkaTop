import { promises as fs } from 'node:fs';

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Gauge } from 'prom-client';

import { METRIC_PREFIX } from '../metrics.constants';
import { MetricsService } from '../metrics.service';

/**
 * Default file path the cert-watch sidecar drops the freshest `days_left`
 * integer into (see `infra/deploy/nginx/cert-watch.sh`). Overridable via the
 * `CERT_WATCH_DAYS_LEFT_FILE` env so a local dev run / CI can point the helper
 * at a writable fixture without bind-mounting `/var/lib`.
 */
export const DEFAULT_CERT_WATCH_DAYS_LEFT_FILE = '/var/lib/cert-watch/days_left.txt';

/**
 * Sentinel value rendered when the days-left file is missing/unreadable/empty.
 * The script writes `-1` itself when it cannot reach the domain AND cannot fall
 * back to the on-disk PEM, so an operator sees a negative gauge as "the watcher
 * is broken" rather than the metric silently disappearing. We mirror the same
 * sentinel here so the metric is ALWAYS present in `/metrics` — a missing
 * series would be indistinguishable from "fine".
 */
export const CERT_EXPIRY_SENTINEL_BROKEN = -1;

/**
 * Pull-style Prometheus helper that exposes `ruletka_cert_expiry_days{domain}`
 * by reading the days-left integer the cert-watch sidecar writes once a day to
 * a small file on a SHARED volume (default
 * {@link DEFAULT_CERT_WATCH_DAYS_LEFT_FILE}). The watcher script does the real
 * work — TLS handshake + `openssl x509 -enddate`, optional PEM fallback,
 * Telegram alert when below the warning threshold; this helper's only job is
 * to surface the latest sample as a Prometheus gauge so the existing scrape
 * (`GET /api/metrics`) becomes the durable observability surface and existing
 * Prometheus alerting can fire on `cert_expiry_days < 14` (or the more
 * aggressive `cert_expiry_days < 7`) without an additional exporter.
 *
 * Why pull-style: the file is the source of truth (written daily by cron) and
 * the API process should not itself reach out to `openssl s_client` — that
 * would either duplicate the sidecar work or fail in non-prod where there is
 * no HTTPS listener bound. The `collect` callback re-reads the file at every
 * scrape so a stale-by-hours sample stays accurate to within ~one cron tick,
 * and Prometheus already records the SCRAPE timestamp — recency is captured
 * implicitly without an extra `last_updated` series.
 *
 * Failure modes (all safe):
 *   • file missing / unreadable / empty / non-numeric → gauge reports
 *     {@link CERT_EXPIRY_SENTINEL_BROKEN} so the operator can alert on
 *     `cert_expiry_days < 0` ("the WATCHER is broken") separately from
 *     `cert_expiry_days < 14` ("the CERT is about to expire").
 *   • registry registration race (the gauge name already exists in tests that
 *     re-instantiate the module) → the existing series is reused; we never
 *     double-register, which would otherwise throw at boot.
 *   • a Redis/Mongo blip is irrelevant — this helper touches only the local
 *     filesystem.
 */
@Injectable()
export class CertExpiryHealth implements OnModuleInit {
  private readonly logger = new Logger(CertExpiryHealth.name);

  /** Resolved at construction so tests can point us at a fixture file. */
  private readonly daysLeftFile: string;

  /** The single domain label value baked into the gauge (closed-set, low cardinality). */
  private readonly domain: string;

  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {
    this.daysLeftFile =
      this.config.get<string>('CERT_WATCH_DAYS_LEFT_FILE') ?? DEFAULT_CERT_WATCH_DAYS_LEFT_FILE;
    this.domain = this.config.get<string>('CERT_WATCH_DOMAIN') ?? 'ruletka.top';
  }

  /**
   * Register the pull-style `cert_expiry_days{domain}` gauge on the metrics
   * service's dedicated registry — same surface the rest of the custom
   * series live on, so a single `/api/metrics` scrape returns it.
   *
   * The `collect` callback is `async` and re-reads the file at every scrape;
   * prom-client awaits it before serialising, so the sample is always the
   * freshest the cron has written. If the file is missing/unreadable we emit
   * {@link CERT_EXPIRY_SENTINEL_BROKEN} rather than failing the scrape — the
   * scrape MUST stay green so the other metrics on this registry continue
   * to deliver.
   */
  onModuleInit(): void {
    const registry = this.metrics.getRegistry();
    const metricName = `${METRIC_PREFIX}cert_expiry_days`;

    // Re-registration guard: jest re-creates the module per test file and
    // prom-client throws on a duplicate registration. Returning the existing
    // metric on conflict keeps tests isolated without `getSingleMetric` magic
    // in production paths (where this only ever runs once).
    if (registry.getSingleMetric(metricName)) {
      this.logger.debug(`${metricName} already registered — reusing it.`);
      return;
    }

    const gauge = new Gauge<'domain'>({
      name: metricName,
      help: 'Days remaining on the HTTPS cert covering {domain}. -1 ⇒ cert-watch sidecar broken (file missing/unreadable).',
      labelNames: ['domain'],
      registers: [registry],
      collect: async (): Promise<void> => {
        const value = await this.readDaysLeft();
        gauge.set({ domain: this.domain }, value);
      },
    });

    this.logger.log(
      `Registered ${metricName}{domain="${this.domain}"} — reading days-left from ${this.daysLeftFile}.`,
    );
  }

  /**
   * Read the integer days-left value the cert-watch script writes to the
   * shared volume. EXPORTED for the spec — kept narrow on purpose: any I/O
   * error, missing file, empty file, or non-numeric content collapses to
   * {@link CERT_EXPIRY_SENTINEL_BROKEN}. We don't log on every miss (the
   * scrape can be ~15s and a flapping read would spam logs) — operators
   * detect the broken state via `cert_expiry_days < 0` alert rules.
   */
  async readDaysLeft(): Promise<number> {
    try {
      const raw = await fs.readFile(this.daysLeftFile, 'utf8');
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        return CERT_EXPIRY_SENTINEL_BROKEN;
      }
      // The script writes a plain integer; tolerate a trailing newline (handled
      // by trim above) and reject anything else as broken so we never publish
      // a stale `NaN` that would render as `Nan` in exposition format.
      const parsed = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(parsed)) {
        return CERT_EXPIRY_SENTINEL_BROKEN;
      }
      return parsed;
    } catch {
      // ENOENT / EACCES / EISDIR / … all collapse to the broken sentinel.
      // The scrape endpoint MUST stay green; we never propagate the error.
      return CERT_EXPIRY_SENTINEL_BROKEN;
    }
  }
}
