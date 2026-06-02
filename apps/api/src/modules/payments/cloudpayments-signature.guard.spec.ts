import { createHmac } from 'node:crypto';

import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CloudPaymentsSignatureGuard } from './cloudpayments-signature.guard';

const SECRET = 'test-merchant-secret';
const RAW_BODY = Buffer.from('TransactionId=1&Amount=100&InvoiceId=inv-1');

/** Correct base64 HMAC-SHA256 of RAW_BODY under SECRET. */
function validHmac(): string {
  return createHmac('sha256', SECRET).update(RAW_BODY).digest('base64');
}

/** Build a ConfigService stub returning the given secret + IP allow-list. */
function configWith(secret: string, ips: string): ConfigService {
  return {
    get: (key: string, fallback?: string) => {
      if (key === 'CLOUDPAYMENTS_API_SECRET') return secret;
      if (key === 'CLOUDPAYMENTS_WEBHOOK_IPS') return ips;
      return fallback ?? '';
    },
  } as unknown as ConfigService;
}

/** Build an ExecutionContext whose request carries ip / hmac header / rawBody. */
function makeContext(opts: {
  ip?: string;
  hmac?: string | null;
  rawBody?: Buffer;
}): ExecutionContext {
  const headers: Record<string, string> = {};
  if (opts.hmac) {
    headers['content-hmac'] = opts.hmac;
  }
  const request = { ip: opts.ip, headers, rawBody: opts.rawBody };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CloudPaymentsSignatureGuard — IP allow-list', () => {
  it('allows an allow-listed source with a valid HMAC', () => {
    const guard = new CloudPaymentsSignatureGuard(configWith(SECRET, '203.0.113.7, 203.0.113.8'));
    const ctx = makeContext({ ip: '203.0.113.7', hmac: validHmac(), rawBody: RAW_BODY });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects (403) a non-allow-listed source BEFORE checking HMAC', () => {
    const guard = new CloudPaymentsSignatureGuard(configWith(SECRET, '203.0.113.7'));
    // Even with a perfectly valid HMAC, a bad source IP is forbidden.
    const ctx = makeContext({ ip: '198.51.100.1', hmac: validHmac(), rawBody: RAW_BODY });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('matches an IPv4-mapped-IPv6 source against a plain-IPv4 allow-list entry', () => {
    const guard = new CloudPaymentsSignatureGuard(configWith(SECRET, '203.0.113.7'));
    const ctx = makeContext({
      ip: '::ffff:203.0.113.7',
      hmac: validHmac(),
      rawBody: RAW_BODY,
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('skips the IP check entirely when CLOUDPAYMENTS_WEBHOOK_IPS is unset (HMAC only)', () => {
    const guard = new CloudPaymentsSignatureGuard(configWith(SECRET, ''));
    // Any source is fine as long as the HMAC is valid.
    const ctx = makeContext({ ip: '198.51.100.9', hmac: validHmac(), rawBody: RAW_BODY });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('still enforces HMAC for an allow-listed source (bad signature → 401)', () => {
    const guard = new CloudPaymentsSignatureGuard(configWith(SECRET, '203.0.113.7'));
    const ctx = makeContext({
      ip: '203.0.113.7',
      hmac: Buffer.from('wrong').toString('base64'),
      rawBody: RAW_BODY,
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects (403) when allow-list is set but the request has no source IP', () => {
    const guard = new CloudPaymentsSignatureGuard(configWith(SECRET, '203.0.113.7'));
    const ctx = makeContext({ ip: undefined, hmac: validHmac(), rawBody: RAW_BODY });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
