import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';

import { CertExpiryHealth, CERT_EXPIRY_SENTINEL_BROKEN } from './cert-expiry.health';
import { MetricsService } from '../metrics.service';

/**
 * Build a ConfigService stub returning a fixed `CERT_WATCH_DAYS_LEFT_FILE` (and
 * optional `CERT_WATCH_DOMAIN`). Mirrors the stub shape used in
 * `metrics-token.guard.spec.ts` — no real Nest container is needed.
 */
function configWith(env: Record<string, string | undefined>): ConfigService {
  return {
    get: <T = string>(key: string): T | undefined => env[key] as unknown as T | undefined,
  } as unknown as ConfigService;
}

/** Resolving zcard keeps the queue-depth gauge's `collect` happy during render. */
function fakeRedis(): Redis {
  return { zcard: jest.fn().mockResolvedValue(0) } as unknown as Redis;
}

/**
 * Exercises the REAL prom-client registry (via MetricsService.getRegistry()) so
 * we prove the gauge renders in Prometheus exposition format with the expected
 * `{domain}` label — and that the broken-watcher sentinel surfaces cleanly when
 * the file is missing.
 */
describe('CertExpiryHealth', () => {
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = join(tmpdir(), `cert-watch-days-left-${process.pid}-${Date.now()}.txt`);
  });

  afterEach(async () => {
    await fs.unlink(tmpFile).catch(() => undefined);
  });

  describe('readDaysLeft()', () => {
    it('returns the integer the cert-watch sidecar wrote', async () => {
      await fs.writeFile(tmpFile, '42\n', 'utf8');
      const helper = new CertExpiryHealth(
        new MetricsService(fakeRedis()),
        configWith({ CERT_WATCH_DAYS_LEFT_FILE: tmpFile }),
      );
      await expect(helper.readDaysLeft()).resolves.toBe(42);
    });

    it('returns the sentinel when the file is missing', async () => {
      const helper = new CertExpiryHealth(
        new MetricsService(fakeRedis()),
        configWith({ CERT_WATCH_DAYS_LEFT_FILE: tmpFile }),
      );
      await expect(helper.readDaysLeft()).resolves.toBe(CERT_EXPIRY_SENTINEL_BROKEN);
    });

    it('returns the sentinel when the file is empty (watcher wrote nothing)', async () => {
      await fs.writeFile(tmpFile, '', 'utf8');
      const helper = new CertExpiryHealth(
        new MetricsService(fakeRedis()),
        configWith({ CERT_WATCH_DAYS_LEFT_FILE: tmpFile }),
      );
      await expect(helper.readDaysLeft()).resolves.toBe(CERT_EXPIRY_SENTINEL_BROKEN);
    });

    it('returns the sentinel when the file is non-numeric (corrupted write)', async () => {
      await fs.writeFile(tmpFile, 'not-a-number\n', 'utf8');
      const helper = new CertExpiryHealth(
        new MetricsService(fakeRedis()),
        configWith({ CERT_WATCH_DAYS_LEFT_FILE: tmpFile }),
      );
      await expect(helper.readDaysLeft()).resolves.toBe(CERT_EXPIRY_SENTINEL_BROKEN);
    });

    it('handles a negative integer (the watcher itself emitted -1)', async () => {
      // The script writes -1 when both openssl s_client AND the PEM fallback
      // failed — we preserve the value end-to-end so the operator's alert on
      // `cert_expiry_days < 0` ("watcher broken") still fires.
      await fs.writeFile(tmpFile, '-1\n', 'utf8');
      const helper = new CertExpiryHealth(
        new MetricsService(fakeRedis()),
        configWith({ CERT_WATCH_DAYS_LEFT_FILE: tmpFile }),
      );
      await expect(helper.readDaysLeft()).resolves.toBe(-1);
    });
  });

  describe('Prometheus exposition (end-to-end via the real registry)', () => {
    it('renders ruletka_cert_expiry_days{domain="…"} after onModuleInit', async () => {
      await fs.writeFile(tmpFile, '21\n', 'utf8');
      const metrics = new MetricsService(fakeRedis());
      const helper = new CertExpiryHealth(
        metrics,
        configWith({ CERT_WATCH_DAYS_LEFT_FILE: tmpFile, CERT_WATCH_DOMAIN: 'ruletka.top' }),
      );

      helper.onModuleInit();
      const body = await metrics.render();

      expect(body).toContain('ruletka_cert_expiry_days');
      expect(body).toMatch(/ruletka_cert_expiry_days\{domain="ruletka\.top"\}\s+21/);
    });

    it('renders the sentinel (-1) when the days-left file is missing on scrape', async () => {
      const metrics = new MetricsService(fakeRedis());
      const helper = new CertExpiryHealth(
        metrics,
        configWith({ CERT_WATCH_DAYS_LEFT_FILE: tmpFile, CERT_WATCH_DOMAIN: 'ruletka.top' }),
      );

      helper.onModuleInit();
      const body = await metrics.render();

      // Missing file ⇒ sentinel ⇒ operator alert on `cert_expiry_days < 0`.
      expect(body).toMatch(/ruletka_cert_expiry_days\{domain="ruletka\.top"\}\s+-1/);
    });

    it('falls back to the default domain (ruletka.top) when CERT_WATCH_DOMAIN is unset', async () => {
      await fs.writeFile(tmpFile, '7\n', 'utf8');
      const metrics = new MetricsService(fakeRedis());
      const helper = new CertExpiryHealth(
        metrics,
        configWith({ CERT_WATCH_DAYS_LEFT_FILE: tmpFile }),
      );

      helper.onModuleInit();
      const body = await metrics.render();

      // Default domain is the production apex so a fresh deploy publishes a
      // meaningful series without operator config.
      expect(body).toMatch(/ruletka_cert_expiry_days\{domain="ruletka\.top"\}\s+7/);
    });

    it('reflects fresh writes on subsequent scrapes (pull-style, not cached)', async () => {
      await fs.writeFile(tmpFile, '30\n', 'utf8');
      const metrics = new MetricsService(fakeRedis());
      const helper = new CertExpiryHealth(
        metrics,
        configWith({ CERT_WATCH_DAYS_LEFT_FILE: tmpFile, CERT_WATCH_DOMAIN: 'ruletka.top' }),
      );

      helper.onModuleInit();
      const first = await metrics.render();
      expect(first).toMatch(/ruletka_cert_expiry_days\{domain="ruletka\.top"\}\s+30/);

      // The cert-watch cron tick rewrites the file with the latest days_left.
      await fs.writeFile(tmpFile, '13\n', 'utf8');
      const second = await metrics.render();
      expect(second).toMatch(/ruletka_cert_expiry_days\{domain="ruletka\.top"\}\s+13/);
    });

    it('does not double-register the gauge if onModuleInit runs twice (defensive)', () => {
      const metrics = new MetricsService(fakeRedis());
      const helper = new CertExpiryHealth(
        metrics,
        configWith({ CERT_WATCH_DAYS_LEFT_FILE: tmpFile, CERT_WATCH_DOMAIN: 'ruletka.top' }),
      );

      helper.onModuleInit();
      // A second init must not throw "metric already registered" — prom-client
      // would normally throw, our guard reuses the existing series.
      expect(() => helper.onModuleInit()).not.toThrow();
    });
  });
});
