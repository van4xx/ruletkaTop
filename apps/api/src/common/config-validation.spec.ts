import type { ConfigService } from '@nestjs/config';
import type { LoggerService } from '@nestjs/common';

import { validateCriticalConfig } from './config-validation';

/**
 * Minimal `ConfigService` stub backed by a plain record: `get(name)` returns the
 * configured value or `undefined`. Mirrors how the guard reads env via
 * `config.get<string>(name)` without standing up the real Nest config plumbing.
 */
function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return {
    get: <T = string>(name: string): T | undefined => env[name] as unknown as T | undefined,
  } as unknown as ConfigService;
}

/** A Nest LoggerService spy capturing every level. */
function makeLogger(): jest.Mocked<LoggerService> {
  return {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  } as unknown as jest.Mocked<LoggerService>;
}

/** Strong, non-placeholder secret values used to satisfy the critical checks. */
const GOOD = {
  JWT_ACCESS_SECRET: 'b8f1c0e2a7d94f3e8c1a6b5d4e2f9a0c7b3d6e1f',
  JWT_REFRESH_SECRET: 'f0a9c8e7d6b5a4938271605f4e3d2c1b0a9f8e7d',
};

describe('validateCriticalConfig', () => {
  describe('production enforcement', () => {
    it('throws when a critical secret is MISSING in production', () => {
      const config = makeConfig({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: GOOD.JWT_ACCESS_SECRET,
        // JWT_REFRESH_SECRET missing
      });
      const logger = makeLogger();

      expect(() => validateCriticalConfig(config, logger)).toThrow(/JWT_REFRESH_SECRET/);
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('throws when a critical secret is left at the shipped placeholder', () => {
      const config = makeConfig({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'change-me-access-secret',
        JWT_REFRESH_SECRET: 'change-me-refresh-secret',
      });

      expect(() => validateCriticalConfig(config, makeLogger())).toThrow(
        /JWT_ACCESS_SECRET, JWT_REFRESH_SECRET/,
      );
    });

    it('treats a blank/whitespace secret as missing', () => {
      const config = makeConfig({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: '   ',
        JWT_REFRESH_SECRET: GOOD.JWT_REFRESH_SECRET,
      });

      expect(() => validateCriticalConfig(config, makeLogger())).toThrow(/JWT_ACCESS_SECRET/);
    });

    it('passes when all critical secrets are present and non-placeholder', () => {
      const config = makeConfig({ NODE_ENV: 'production', ...GOOD });
      const logger = makeLogger();

      expect(() => validateCriticalConfig(config, logger)).not.toThrow();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('NEVER logs the secret value — only the offending var name', () => {
      const config = makeConfig({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'super-secret-real-value-should-never-appear',
        JWT_REFRESH_SECRET: 'change-me-refresh-secret', // placeholder → offender
      });
      const logger = makeLogger();

      // Only the refresh secret is an offender; the access secret is a real value.
      expect(() => validateCriticalConfig(config, logger)).toThrow();
      const loggedError = (logger.error as jest.Mock).mock.calls[0]?.[0] as string;
      expect(loggedError).toContain('JWT_REFRESH_SECRET');
      // The real secret value must not leak into any log line.
      expect(loggedError).not.toContain('super-secret-real-value-should-never-appear');
    });
  });

  describe('non-production is never fatal', () => {
    it('does NOT throw in development even with placeholder critical secrets', () => {
      const config = makeConfig({
        NODE_ENV: 'development',
        JWT_ACCESS_SECRET: 'change-me-access-secret',
        JWT_REFRESH_SECRET: 'change-me-refresh-secret',
      });
      const logger = makeLogger();

      expect(() => validateCriticalConfig(config, logger)).not.toThrow();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('does NOT throw in test even with all critical secrets missing', () => {
      const config = makeConfig({ NODE_ENV: 'test' });
      expect(() => validateCriticalConfig(config, makeLogger())).not.toThrow();
    });
  });

  describe('recommended integrations (WARN, non-fatal)', () => {
    it('WARNs for each unconfigured optional integration', () => {
      // Critical secrets good so the fatal path is not taken; all optional groups blank.
      const config = makeConfig({ NODE_ENV: 'production', ...GOOD });
      const logger = makeLogger();

      validateCriticalConfig(config, logger);

      // CloudPayments, TURN, SMTP, VAPID → 4 advisory warnings.
      expect(logger.warn).toHaveBeenCalledTimes(4);
      const warned = (logger.warn as jest.Mock).mock.calls.map((c) => c[0] as string).join('\n');
      expect(warned).toContain('CloudPayments');
      expect(warned).toContain('TURN');
      expect(warned).toContain('SMTP');
      expect(warned).toContain('VAPID');
    });

    it('does NOT warn for an integration that is fully configured', () => {
      const config = makeConfig({
        NODE_ENV: 'production',
        ...GOOD,
        CLOUDPAYMENTS_PUBLIC_ID: 'pk_live_123',
        CLOUDPAYMENTS_API_SECRET: 'sk_live_abc',
        TURN_STATIC_AUTH_SECRET: 'a-strong-turn-secret-value',
        SMTP_HOST: 'mail.ruletka.top',
        SMTP_USER: 'noreply',
        SMTP_PASS: 'mail-pass',
        VAPID_PUBLIC_KEY: 'BPublicKeyMaterial',
        VAPID_PRIVATE_KEY: 'PrivateKeyMaterial',
      });
      const logger = makeLogger();

      validateCriticalConfig(config, logger);

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
