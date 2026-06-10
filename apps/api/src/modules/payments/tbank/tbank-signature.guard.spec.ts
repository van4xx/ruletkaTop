import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { signTbankToken } from './tbank-signature';
import { TbankSignatureGuard } from './tbank-signature.guard';

const PASSWORD = 'wh-secret';

function configWith(password: string, ips = ''): ConfigService {
  return {
    get: (key: string, fallback?: string) => {
      if (key === 'TBANK_PASSWORD') return password;
      if (key === 'TBANK_WEBHOOK_IPS') return ips;
      return fallback ?? '';
    },
  } as unknown as ConfigService;
}

function makeContext(opts: { ip?: string; body?: unknown }): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip: opts.ip, headers: {}, body: opts.body }),
    }),
  } as unknown as ExecutionContext;
}

/** Build a signed payload that the guard would accept. */
function signedBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const payload = {
    TerminalKey: 'TK',
    OrderId: 'order-1',
    Success: true,
    Status: 'CONFIRMED',
    PaymentId: '999',
    Amount: 19900,
    ...extra,
  };
  return { ...payload, Token: signTbankToken(payload, PASSWORD) };
}

describe('TbankSignatureGuard', () => {
  it('accepts a webhook with a valid Token', () => {
    const guard = new TbankSignatureGuard(configWith(PASSWORD));
    expect(guard.canActivate(makeContext({ body: signedBody() }))).toBe(true);
  });

  it('rejects a tampered body (Token no longer matches)', () => {
    const body = signedBody();
    body.Amount = 1; // tamper
    const guard = new TbankSignatureGuard(configWith(PASSWORD));
    expect(() => guard.canActivate(makeContext({ body }))).toThrow(UnauthorizedException);
  });

  it('rejects when Token field is missing', () => {
    const body = signedBody();
    delete (body as Record<string, unknown>).Token;
    const guard = new TbankSignatureGuard(configWith(PASSWORD));
    expect(() => guard.canActivate(makeContext({ body }))).toThrow(UnauthorizedException);
  });

  it('rejects when no Password is configured (fail-closed)', () => {
    const guard = new TbankSignatureGuard(configWith(''));
    expect(() => guard.canActivate(makeContext({ body: signedBody() }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects when body is missing entirely', () => {
    const guard = new TbankSignatureGuard(configWith(PASSWORD));
    expect(() => guard.canActivate(makeContext({}))).toThrow(UnauthorizedException);
  });
});
