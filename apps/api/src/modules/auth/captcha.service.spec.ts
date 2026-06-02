import type { ConfigService } from '@nestjs/config';

import { CaptchaService } from './captcha.service';

/**
 * CaptchaService unit tests.
 *
 * The service is instantiated directly with a typed `ConfigService` mock (the
 * project's allowed second testing style). `fetch` (Cloudflare Turnstile
 * siteverify) is stubbed on the global object so no network is touched.
 */

/** Build a CaptchaService whose `TURNSTILE_SECRET` resolves to `secret`. */
function makeService(secret: string | undefined): CaptchaService {
  const configService = {
    get: jest.fn().mockImplementation((key: string) =>
      key === 'TURNSTILE_SECRET' ? secret : undefined,
    ),
  } as unknown as ConfigService;
  return new CaptchaService(configService);
}

/** Stub global fetch to resolve with the given Turnstile JSON body + status. */
function stubFetch(body: unknown, ok = true, status = 200): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('CaptchaService — disabled (no secret, dev no-op)', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('reports disabled and accepts ANY token without calling fetch', async () => {
    const fetchMock = stubFetch({ success: false });
    const service = makeService(undefined);

    expect(service.isEnabled()).toBe(false);
    await expect(service.verify('whatever')).resolves.toBe(true);
    // No token at all is also accepted when disabled.
    await expect(service.verify(undefined)).resolves.toBe(true);
    await expect(service.verify('')).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a blank/whitespace secret as disabled', async () => {
    const service = makeService('   ');
    expect(service.isEnabled()).toBe(false);
    await expect(service.verify('whatever')).resolves.toBe(true);
  });
});

describe('CaptchaService — enabled (secret configured)', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('is enabled and POSTs secret + response (+ remoteip) to the Turnstile endpoint', async () => {
    const fetchMock = stubFetch({ success: true });
    const service = makeService('sk_test_secret');

    expect(service.isEnabled()).toBe(true);
    await expect(service.verify('client-token', '1.2.3.4')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');
    const body = init.body as URLSearchParams;
    expect(body.get('secret')).toBe('sk_test_secret');
    expect(body.get('response')).toBe('client-token');
    expect(body.get('remoteip')).toBe('1.2.3.4');
  });

  it('omits remoteip when no IP is supplied', async () => {
    const fetchMock = stubFetch({ success: true });
    const service = makeService('sk_test_secret');

    await service.verify('client-token');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.body as URLSearchParams).has('remoteip')).toBe(false);
  });

  it('returns false when Turnstile responds success:false', async () => {
    stubFetch({ success: false, 'error-codes': ['invalid-input-response'] });
    const service = makeService('sk_test_secret');
    await expect(service.verify('bad-token')).resolves.toBe(false);
  });

  it('rejects a missing/blank token WITHOUT calling fetch', async () => {
    const fetchMock = stubFetch({ success: true });
    const service = makeService('sk_test_secret');

    await expect(service.verify(undefined)).resolves.toBe(false);
    await expect(service.verify('')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails CLOSED on a non-2xx HTTP response', async () => {
    stubFetch({}, false, 500);
    const service = makeService('sk_test_secret');
    await expect(service.verify('token')).resolves.toBe(false);
  });

  it('fails CLOSED when fetch throws (network/abort)', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('network down'));
    (globalThis as unknown as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;
    const service = makeService('sk_test_secret');
    await expect(service.verify('token')).resolves.toBe(false);
  });
});
