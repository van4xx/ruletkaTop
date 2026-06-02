import type { ConfigService } from '@nestjs/config';

import {
  decodeDataUrl,
  mapSightengineToFrameScore,
  NoOpFrameScorer,
  ProviderFrameScorer,
  resolveFrameScorer,
} from './frame-scorer';

/**
 * Frame-scorer unit tests.
 *
 * `ProviderFrameScorer` is instantiated directly with a typed `ConfigService`
 * mock (mirroring `captcha.service.spec.ts`), and global `fetch` is stubbed so
 * no network is touched. The provider is Sightengine `check.json`.
 *
 * Invariants under test:
 *  - keyless ⇒ behaves as the no-op (never calls fetch, returns safe/0);
 *  - configured ⇒ POSTs the frame as multipart `media` + maps nudity/gore
 *    probabilities onto the contract label + a [0,1] score;
 *  - FAIL-OPEN ⇒ any provider failure returns safe/0 (never throws/blocks).
 */

/** A 1x1 JPEG-ish base64 data-URL (content is irrelevant; we mock the API). */
const EVIDENCE = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

type ConfigMap = Record<string, string | undefined>;

/** Build a ConfigService whose `get(key)` reads from `map` (with defaults). */
function makeConfig(map: ConfigMap): ConfigService {
  return {
    get: jest.fn().mockImplementation((key: string, fallback?: string) =>
      key in map ? map[key] : fallback,
    ),
  } as unknown as ConfigService;
}

/** Both Sightengine credentials present. */
const ENABLED: ConfigMap = {
  SIGHTENGINE_API_USER: 'user-123',
  MODERATION_PROVIDER_API_KEY: 'secret-abc',
};

/** Stub global fetch to resolve with the given Sightengine body + status. */
function stubFetch(body: unknown, ok = true, status = 200): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

/** A successful Sightengine envelope with the given detection blocks. */
function sightengineOk(blocks: Record<string, unknown>): Record<string, unknown> {
  return {
    status: 'success',
    request: { id: 'req_1', timestamp: 1, operations: 1 },
    ...blocks,
  };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('ProviderFrameScorer — disabled (no credentials, no-op)', () => {
  it('returns safe/0 and never calls fetch when BOTH creds are unset', async () => {
    const fetchMock = stubFetch(sightengineOk({}));
    const scorer = new ProviderFrameScorer(makeConfig({}));

    await expect(scorer.score(EVIDENCE)).resolves.toEqual({ label: 'safe', score: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stays disabled when only api_user is set (secret missing)', async () => {
    const fetchMock = stubFetch(sightengineOk({}));
    const scorer = new ProviderFrameScorer(makeConfig({ SIGHTENGINE_API_USER: 'user-123' }));

    await expect(scorer.score(EVIDENCE)).resolves.toEqual({ label: 'safe', score: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stays disabled when only the secret is set (api_user missing)', async () => {
    const fetchMock = stubFetch(sightengineOk({}));
    const scorer = new ProviderFrameScorer(
      makeConfig({ MODERATION_PROVIDER_API_KEY: 'secret-abc' }),
    );

    await expect(scorer.score(EVIDENCE)).resolves.toEqual({ label: 'safe', score: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ProviderFrameScorer — enabled (credentials configured)', () => {
  it('POSTs the frame as multipart media + the models/creds to the check.json endpoint', async () => {
    const fetchMock = stubFetch(
      sightengineOk({ nudity: { none: 0.99, sexual_activity: 0.01 } }),
    );
    const scorer = new ProviderFrameScorer(makeConfig(ENABLED));

    await scorer.score(EVIDENCE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.sightengine.com/1.0/check.json');
    expect(init.method).toBe('POST');

    // multipart FormData with the documented field names.
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('models')).toBe('nudity-2.1,gore-2.0');
    expect(form.get('api_user')).toBe('user-123');
    expect(form.get('api_secret')).toBe('secret-abc');
    expect(form.get('media')).toBeInstanceOf(Blob);

    // An abort signal is wired (request timeout).
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps a confident nudity response to label "nudity" with its probability', async () => {
    stubFetch(
      sightengineOk({
        nudity: { erotica: 0.82, suggestive: 0.4, none: 0.18, sexual_activity: 0.02 },
        gore: { prob: 0.01 },
      }),
    );
    const scorer = new ProviderFrameScorer(makeConfig(ENABLED));

    await expect(scorer.score(EVIDENCE)).resolves.toEqual({ label: 'nudity', score: 0.82 });
  });

  it('maps explicit sexual activity to label "sexual"', async () => {
    stubFetch(
      sightengineOk({
        nudity: { sexual_activity: 0.95, sexual_display: 0.3, erotica: 0.2, none: 0.05 },
      }),
    );
    const scorer = new ProviderFrameScorer(makeConfig(ENABLED));

    await expect(scorer.score(EVIDENCE)).resolves.toEqual({ label: 'sexual', score: 0.95 });
  });

  it('maps a high gore probability to label "violence"', async () => {
    stubFetch(
      sightengineOk({
        nudity: { none: 0.99 },
        gore: { prob: 0.91, classes: { very_bloody: 0.8 } },
      }),
    );
    const scorer = new ProviderFrameScorer(makeConfig(ENABLED));

    await expect(scorer.score(EVIDENCE)).resolves.toEqual({ label: 'violence', score: 0.91 });
  });

  it('returns safe/0 when every probability is below the min threshold', async () => {
    stubFetch(
      sightengineOk({
        nudity: { erotica: 0.2, suggestive: 0.3, none: 0.5 },
        gore: { prob: 0.1 },
      }),
    );
    const scorer = new ProviderFrameScorer(makeConfig(ENABLED));

    await expect(scorer.score(EVIDENCE)).resolves.toEqual({ label: 'safe', score: 0 });
  });

  it('honours a custom SIGHTENGINE_MIN_PROB threshold', async () => {
    stubFetch(sightengineOk({ nudity: { suggestive: 0.35, none: 0.65 } }));
    const scorer = new ProviderFrameScorer(
      makeConfig({ ...ENABLED, SIGHTENGINE_MIN_PROB: '0.3' }),
    );

    await expect(scorer.score(EVIDENCE)).resolves.toEqual({ label: 'nudity', score: 0.35 });
  });

  it('honours a custom SIGHTENGINE_MODELS list', async () => {
    const fetchMock = stubFetch(sightengineOk({ nudity: { none: 0.99 } }));
    const scorer = new ProviderFrameScorer(
      makeConfig({ ...ENABLED, SIGHTENGINE_MODELS: 'nudity-2.1' }),
    );

    await scorer.score(EVIDENCE);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.body as FormData).get('models')).toBe('nudity-2.1');
  });

  it('returns safe/0 WITHOUT calling fetch when there is no evidence frame', async () => {
    const fetchMock = stubFetch(sightengineOk({}));
    const scorer = new ProviderFrameScorer(makeConfig(ENABLED));

    await expect(scorer.score(undefined)).resolves.toEqual({ label: 'safe', score: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns safe/0 WITHOUT calling fetch when evidence is not a decodable data-URL', async () => {
    const fetchMock = stubFetch(sightengineOk({}));
    const scorer = new ProviderFrameScorer(makeConfig(ENABLED));

    await expect(scorer.score('not-a-data-url')).resolves.toEqual({ label: 'safe', score: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ProviderFrameScorer — fail-open (provider errors never block)', () => {
  it('fails OPEN (safe/0) on a non-2xx HTTP response', async () => {
    stubFetch({ status: 'failure', error: { message: 'rate limit' } }, false, 429);
    const scorer = new ProviderFrameScorer(makeConfig(ENABLED));

    await expect(scorer.score(EVIDENCE)).resolves.toEqual({ label: 'safe', score: 0 });
  });

  it('fails OPEN when the body reports status:"failure"', async () => {
    stubFetch({ status: 'failure', error: { type: 'usage_limit', message: 'quota' } });
    const scorer = new ProviderFrameScorer(makeConfig(ENABLED));

    await expect(scorer.score(EVIDENCE)).resolves.toEqual({ label: 'safe', score: 0 });
  });

  it('fails OPEN when fetch throws (network/abort)', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('network down'));
    (globalThis as unknown as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;
    const scorer = new ProviderFrameScorer(makeConfig(ENABLED));

    await expect(scorer.score(EVIDENCE)).resolves.toEqual({ label: 'safe', score: 0 });
  });

  it('fails OPEN on a malformed (non-JSON) body', async () => {
    const fn = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
    const scorer = new ProviderFrameScorer(makeConfig(ENABLED));

    await expect(scorer.score(EVIDENCE)).resolves.toEqual({ label: 'safe', score: 0 });
  });
});

describe('resolveFrameScorer — factory selection', () => {
  it('defaults to the no-op when FRAME_SCORER is unset', () => {
    const scorer = resolveFrameScorer(makeConfig({}));
    expect(scorer).toBeInstanceOf(NoOpFrameScorer);
  });

  it('selects the provider when FRAME_SCORER=provider', () => {
    const scorer = resolveFrameScorer(makeConfig({ FRAME_SCORER: 'provider' }));
    expect(scorer).toBeInstanceOf(ProviderFrameScorer);
  });

  it('returns the no-op for "noop"/"none"/unknown values', () => {
    expect(resolveFrameScorer(makeConfig({ FRAME_SCORER: 'noop' }))).toBeInstanceOf(
      NoOpFrameScorer,
    );
    expect(resolveFrameScorer(makeConfig({ FRAME_SCORER: 'none' }))).toBeInstanceOf(
      NoOpFrameScorer,
    );
    expect(resolveFrameScorer(makeConfig({ FRAME_SCORER: 'whoknows' }))).toBeInstanceOf(
      NoOpFrameScorer,
    );
  });

  it('the provider returned by the factory is itself a no-op without creds', async () => {
    const fetchMock = stubFetch(sightengineOk({ nudity: { sexual_activity: 0.99 } }));
    const scorer = resolveFrameScorer(makeConfig({ FRAME_SCORER: 'provider' }));

    await expect(scorer.score(EVIDENCE)).resolves.toEqual({ label: 'safe', score: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('mapSightengineToFrameScore — pure mapping', () => {
  it('picks the single dominant label across nudity + gore groups', () => {
    const res = {
      status: 'success' as const,
      nudity: { sexual_activity: 0.6, erotica: 0.55 },
      gore: { prob: 0.97 },
    };
    // Gore wins over the (lower) nudity probabilities.
    expect(mapSightengineToFrameScore(res, 0.5)).toEqual({ label: 'violence', score: 0.97 });
  });

  it('ignores mildly_suggestive / none and returns safe when nothing clears the floor', () => {
    const res = {
      status: 'success' as const,
      nudity: { mildly_suggestive: 0.99, none: 0.8, suggestive: 0.1 },
    };
    expect(mapSightengineToFrameScore(res, 0.5)).toEqual({ label: 'safe', score: 0 });
  });

  it('clamps out-of-range / missing probabilities defensively', () => {
    const res = {
      status: 'success' as const,
      nudity: { sexual_display: 1.4 as number },
    };
    expect(mapSightengineToFrameScore(res, 0.5)).toEqual({ label: 'sexual', score: 1 });
  });

  it('returns safe for an empty response', () => {
    expect(mapSightengineToFrameScore({ status: 'success' }, 0.5)).toEqual({
      label: 'safe',
      score: 0,
    });
  });
});

describe('decodeDataUrl', () => {
  it('decodes a base64 image data-URL into bytes + mime', () => {
    const decoded = decodeDataUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
    expect(decoded).not.toBeNull();
    expect(decoded?.mime).toBe('image/jpeg');
    expect(decoded?.bytes.length).toBeGreaterThan(0);
  });

  it('returns null for a non-data-URL string', () => {
    expect(decodeDataUrl('https://example.com/x.jpg')).toBeNull();
    expect(decodeDataUrl('garbage')).toBeNull();
  });

  it('returns null for an empty payload', () => {
    expect(decodeDataUrl('data:image/jpeg;base64,')).toBeNull();
  });
});
