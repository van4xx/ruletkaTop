import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MetricsTokenGuard } from './metrics-token.guard';

/** Build a ConfigService stub returning the given NODE_ENV. */
function configWith(env: Record<string, string | undefined>): ConfigService {
  return {
    get: <T = string>(key: string): T | undefined => env[key] as unknown as T | undefined,
  } as unknown as ConfigService;
}

/** Build an ExecutionContext whose request carries the given Authorization header. */
function makeContext(authorization?: string): ExecutionContext {
  const request = { headers: authorization ? { authorization } : {} };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('MetricsTokenGuard', () => {
  describe('open endpoint when no token configured (dev/test)', () => {
    it('allows any request when METRICS_TOKEN is undefined in dev', () => {
      const guard = new MetricsTokenGuard(undefined, configWith({ NODE_ENV: 'development' }));
      expect(guard.canActivate(makeContext())).toBe(true);
    });

    it('allows any request when METRICS_TOKEN is blank/whitespace in test', () => {
      const guard = new MetricsTokenGuard('   ', configWith({ NODE_ENV: 'test' }));
      expect(guard.canActivate(makeContext('Bearer anything'))).toBe(true);
    });

    it('treats a missing ConfigService as non-production (dev convenience / DI absent)', () => {
      const guard = new MetricsTokenGuard(undefined, undefined);
      expect(guard.canActivate(makeContext())).toBe(true);
    });
  });

  describe('production FAIL-FAST: METRICS_TOKEN required', () => {
    it('throws at construction when METRICS_TOKEN is unset in production', () => {
      expect(() => new MetricsTokenGuard(undefined, configWith({ NODE_ENV: 'production' }))).toThrow(
        /METRICS_TOKEN is required in production/,
      );
    });

    it('throws at construction when METRICS_TOKEN is blank/whitespace in production', () => {
      expect(() => new MetricsTokenGuard('   ', configWith({ NODE_ENV: 'production' }))).toThrow(
        /METRICS_TOKEN is required in production/,
      );
    });

    it('boots (does not throw) when METRICS_TOKEN is set in production', () => {
      expect(
        () => new MetricsTokenGuard('a-strong-metrics-token', configWith({ NODE_ENV: 'production' })),
      ).not.toThrow();
    });
  });

  describe('bearer enforcement when a token IS configured', () => {
    const TOKEN = 'a-strong-metrics-token';

    it('allows a request presenting the correct bearer token', () => {
      const guard = new MetricsTokenGuard(TOKEN, configWith({ NODE_ENV: 'production' }));
      expect(guard.canActivate(makeContext(`Bearer ${TOKEN}`))).toBe(true);
    });

    it('rejects (401) a request with no Authorization header', () => {
      const guard = new MetricsTokenGuard(TOKEN, configWith({ NODE_ENV: 'production' }));
      expect(() => guard.canActivate(makeContext())).toThrow(UnauthorizedException);
    });

    it('rejects (401) a wrong bearer token (same length)', () => {
      const guard = new MetricsTokenGuard(TOKEN, configWith({ NODE_ENV: 'production' }));
      const wrong = 'X'.repeat(TOKEN.length);
      expect(() => guard.canActivate(makeContext(`Bearer ${wrong}`))).toThrow(UnauthorizedException);
    });

    it('rejects (401) a wrong bearer token (different length)', () => {
      const guard = new MetricsTokenGuard(TOKEN, configWith({ NODE_ENV: 'production' }));
      expect(() => guard.canActivate(makeContext('Bearer short'))).toThrow(UnauthorizedException);
    });

    it('rejects (401) a non-Bearer Authorization scheme', () => {
      const guard = new MetricsTokenGuard(TOKEN, configWith({ NODE_ENV: 'production' }));
      expect(() => guard.canActivate(makeContext(`Basic ${TOKEN}`))).toThrow(UnauthorizedException);
    });
  });
});
