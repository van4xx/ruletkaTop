import type { ConfigService } from '@nestjs/config';

import { MailerService } from './mailer.service';

/**
 * MailerService unit tests.
 *
 * The service is instantiated directly with a typed `ConfigService` mock (the
 * project's allowed second testing style). No network is ever touched: with no
 * `SMTP_HOST` the service builds nodemailer's `jsonTransport`, which serialises
 * the message locally instead of opening a socket — so these tests exercise the
 * REAL transport in its no-op mode.
 */

/** Build a MailerService whose env comes from `env` (missing keys → undefined). */
function makeService(env: Record<string, string | undefined>): MailerService {
  const configService = {
    get: jest.fn().mockImplementation((key: string, fallback?: string) => env[key] ?? fallback),
  } as unknown as ConfigService;
  return new MailerService(configService);
}

describe('MailerService — disabled (no SMTP_HOST, dev no-op)', () => {
  it('reports disabled and "sends" the verification email without throwing', async () => {
    const service = makeService({});
    expect(service.isEnabled()).toBe(false);
    // jsonTransport resolves (no socket); the helper returns true on success.
    await expect(
      service.sendVerificationEmail('user@example.com', 'tok123456789012'),
    ).resolves.toBe(true);
  });

  it('"sends" the password-reset email without throwing', async () => {
    const service = makeService({});
    await expect(
      service.sendPasswordResetEmail('user@example.com', 'tok123456789012'),
    ).resolves.toBe(true);
  });

  it('treats a blank/whitespace SMTP_HOST as disabled', () => {
    expect(makeService({ SMTP_HOST: '   ' }).isEnabled()).toBe(false);
  });
});

describe('MailerService — enabled (SMTP_HOST configured)', () => {
  it('reports enabled when an SMTP host is set', () => {
    const service = makeService({ SMTP_HOST: 'mail.ruletka.top' });
    expect(service.isEnabled()).toBe(true);
  });

  it('does not throw when sending against an unreachable host (best-effort → false)', async () => {
    // Point at a black-hole host/port; the SMTP transport will fail to connect,
    // and the service must SWALLOW that and resolve `false` (never throw) so the
    // auth flows can treat sending as best-effort. Use a short-lived call.
    const service = makeService({
      SMTP_HOST: '127.0.0.1',
      // 1 = a port nothing listens on → connection refused fast.
      SMTP_PORT: '1',
    });
    expect(service.isEnabled()).toBe(true);
    await expect(
      service.sendVerificationEmail('user@example.com', 'tok123456789012'),
    ).resolves.toBe(false);
  }, 20_000);
});
