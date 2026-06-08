import { ConfigService } from '@nestjs/config';

import type { AppNotification } from '@ruletka/shared-types';

import {
  FcmMobilePushProvider,
  NoopMobilePushProvider,
  parseServiceAccount,
  resolveMobilePushProvider,
} from './mobile-push.provider';

// ── Mock `google-auth-library` so `resolveMobilePushProvider` can construct the
// real provider without a live network / real signing. The JWT ctor records its
// args; `getAccessToken` resolves a fixed token. ───────────────────────────────
const jwtCtor = jest.fn();
const getAccessToken = jest.fn().mockResolvedValue({ token: 'ya29.mock-access-token' });
jest.mock('google-auth-library', () => ({
  JWT: jest.fn().mockImplementation((opts: unknown) => {
    jwtCtor(opts);
    return { getAccessToken };
  }),
}));

/** A representative domain notification (same shape Web Push carries). */
const NOTIFICATION: AppNotification = {
  id: 'notif-1',
  kind: 'message',
  title: 'New message',
  body: 'Alice: hey there',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const DEVICE_TOKEN = 'device-token-abc12345';

/** A syntactically valid service account JSON (the key is a dummy, never used
 *  for real signing because `google-auth-library` is mocked). */
const SERVICE_ACCOUNT_JSON = JSON.stringify({
  type: 'service_account',
  project_id: 'ruletka-test',
  client_email: 'fcm@ruletka-test.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\\nMIIdummy\\n-----END PRIVATE KEY-----\\n',
});

/** Build a ConfigService stub returning the given env map. */
function configWith(env: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

/** A `fetch`-shaped mock resolving to the given status + JSON body. */
function fetchReturning(status: number, body: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  jwtCtor.mockClear();
  getAccessToken.mockClear();
  getAccessToken.mockResolvedValue({ token: 'ya29.mock-access-token' });
});

describe('parseServiceAccount', () => {
  it('parses raw JSON and normalises \\n in the private key', () => {
    const account = parseServiceAccount(SERVICE_ACCOUNT_JSON);
    expect(account).not.toBeNull();
    expect(account!.project_id).toBe('ruletka-test');
    expect(account!.client_email).toBe('fcm@ruletka-test.iam.gserviceaccount.com');
    // Literal `\n` became real newlines for the signer.
    expect(account!.private_key).toContain('\n');
    expect(account!.private_key).not.toContain('\\n');
  });

  it('parses base64-encoded JSON', () => {
    const b64 = Buffer.from(SERVICE_ACCOUNT_JSON, 'utf8').toString('base64');
    const account = parseServiceAccount(b64);
    expect(account?.project_id).toBe('ruletka-test');
  });

  it('returns null for blank / undefined / garbage / incomplete input', () => {
    expect(parseServiceAccount(undefined)).toBeNull();
    expect(parseServiceAccount('')).toBeNull();
    expect(parseServiceAccount('   ')).toBeNull();
    expect(parseServiceAccount('not json or base64 !!!')).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ project_id: 'x' }))).toBeNull();
  });
});

describe('resolveMobilePushProvider', () => {
  it('returns a NO-OP (disabled) when FIREBASE_SERVICE_ACCOUNT is unset', () => {
    const provider = resolveMobilePushProvider(configWith({}));
    expect(provider).toBeInstanceOf(NoopMobilePushProvider);
    expect(provider.enabled).toBe(false);
    // Never minted a token / constructed a JWT on the keyless path.
    expect(jwtCtor).not.toHaveBeenCalled();
  });

  it('returns a NO-OP when the credential is set but invalid', () => {
    const provider = resolveMobilePushProvider(
      configWith({ FIREBASE_SERVICE_ACCOUNT: 'totally-not-a-service-account' }),
    );
    expect(provider).toBeInstanceOf(NoopMobilePushProvider);
    expect(provider.enabled).toBe(false);
  });

  it('returns an ENABLED FCM provider, minting via a JWT from the service account', () => {
    const provider = resolveMobilePushProvider(
      configWith({ FIREBASE_SERVICE_ACCOUNT: SERVICE_ACCOUNT_JSON }),
    );
    expect(provider).toBeInstanceOf(FcmMobilePushProvider);
    expect(provider.enabled).toBe(true);
    // The JWT was constructed with the account email + the FCM scope.
    expect(jwtCtor).toHaveBeenCalledTimes(1);
    const opts = jwtCtor.mock.calls[0][0] as { email: string; scopes: string };
    expect(opts.email).toBe('fcm@ruletka-test.iam.gserviceaccount.com');
    expect(opts.scopes).toBe('https://www.googleapis.com/auth/firebase.messaging');
  });

  it('accepts a base64-encoded credential', () => {
    const b64 = Buffer.from(SERVICE_ACCOUNT_JSON, 'utf8').toString('base64');
    const provider = resolveMobilePushProvider(configWith({ FIREBASE_SERVICE_ACCOUNT: b64 }));
    expect(provider.enabled).toBe(true);
  });
});

describe('NoopMobilePushProvider', () => {
  it('reports disabled and never sends', async () => {
    const provider = new NoopMobilePushProvider();
    const result = await provider.send();
    expect(provider.enabled).toBe(false);
    expect(result).toEqual({ ok: false, gone: false });
  });
});

describe('FcmMobilePushProvider.send', () => {
  /** Build a provider over a fake JWT + the given fetch mock. */
  function provider(fetchMock: jest.Mock): FcmMobilePushProvider {
    return new FcmMobilePushProvider(
      { getAccessToken } as unknown as { getAccessToken: typeof getAccessToken },
      'ruletka-test',
      fetchMock as unknown as typeof fetch,
    );
  }

  it('mints a token and POSTs the message to the project send endpoint on success (prunes nothing)', async () => {
    const fetchMock = fetchReturning(200, { name: 'projects/ruletka-test/messages/1' });
    const result = await provider(fetchMock).send(DEVICE_TOKEN, NOTIFICATION);

    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, gone: false });

    // Posted to the v1 send endpoint with the bearer token…
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://fcm.googleapis.com/v1/projects/ruletka-test/messages:send');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer ya29.mock-access-token',
    );

    // …carrying the token + notification + a string-only `data` map for deep-link.
    const sent = JSON.parse(init.body as string) as {
      message: {
        token: string;
        notification: { title: string; body: string };
        data: Record<string, string>;
      };
    };
    expect(sent.message.token).toBe(DEVICE_TOKEN);
    expect(sent.message.notification).toEqual({ title: 'New message', body: 'Alice: hey there' });
    expect(sent.message.data).toMatchObject({ id: 'notif-1', kind: 'message' });
  });

  it('marks the token GONE on a 404 UNREGISTERED response (so the caller prunes it)', async () => {
    const fetchMock = fetchReturning(404, {
      error: {
        code: 404,
        status: 'NOT_FOUND',
        details: [
          { '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' },
        ],
      },
    });
    const result = await provider(fetchMock).send(DEVICE_TOKEN, NOTIFICATION);
    expect(result).toEqual({ ok: false, gone: true });
  });

  it('marks the token GONE on a 400 INVALID_ARGUMENT (malformed token)', async () => {
    const fetchMock = fetchReturning(400, {
      error: {
        code: 400,
        status: 'INVALID_ARGUMENT',
        details: [{ errorCode: 'INVALID_ARGUMENT' }],
      },
    });
    const result = await provider(fetchMock).send(DEVICE_TOKEN, NOTIFICATION);
    expect(result.gone).toBe(true);
  });

  it('does NOT prune on a transient 5xx (logs + keeps the token)', async () => {
    const fetchMock = fetchReturning(503, {
      error: { code: 503, status: 'UNAVAILABLE' },
    });
    const result = await provider(fetchMock).send(DEVICE_TOKEN, NOTIFICATION);
    expect(result).toEqual({ ok: false, gone: false });
  });

  it('does NOT prune when the access-token mint fails (transient auth error)', async () => {
    getAccessToken.mockRejectedValueOnce(new Error('clock skew'));
    const fetchMock = fetchReturning(200, {});
    const result = await provider(fetchMock).send(DEVICE_TOKEN, NOTIFICATION);
    expect(result).toEqual({ ok: false, gone: false });
    // Never attempted the HTTP send without a token.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does NOT prune on a network error from the send (transient)', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const result = await provider(fetchMock).send(DEVICE_TOKEN, NOTIFICATION);
    expect(result).toEqual({ ok: false, gone: false });
  });
});
