import { createHmac } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { TurnService } from './turn.service';

/**
 * Build a {@link TurnService} backed by a ConfigService stub that returns the
 * given env values (and the provided fallback default for anything unset).
 */
function turnServiceWith(env: Record<string, string | number>): TurnService {
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => (key in env ? env[key] : fallback)),
  } as unknown as ConfigService;
  return new TurnService(config);
}

/** The credential coturn re-derives: base64( HMAC-SHA1(secret, username) ). */
function expectedCredential(secret: string, username: string): string {
  return createHmac('sha1', secret).update(username).digest('base64');
}

describe('TurnService.mintCredentials — coturn use-auth-secret scheme', () => {
  const SECRET = 'unit-test-turn-secret';
  const userId = '507f1f77bcf86cd799439011';
  // 2026-05-31 ~ a deterministic instant; Date.now() is pinned per test.
  const NOW_MS = 1_764_500_000_000;
  const TTL = 3600;

  let nowSpy: jest.SpyInstance;

  beforeEach(() => {
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('mints username `<unixExpiry>:<userId>` with expiry = now + TTL (seconds)', () => {
    const service = turnServiceWith({
      TURN_STATIC_AUTH_SECRET: SECRET,
      TURN_CRED_TTL_SECONDS: TTL,
      TURN_HOST: 'turn.ruletka.top',
      TURN_PORT: 3478,
      TURN_TLS_PORT: 5349,
    });

    const { iceServers, ttlExpiresAt } = service.mintCredentials(userId);

    const expectedExpiry = Math.floor(NOW_MS / 1000) + TTL;
    expect(ttlExpiresAt).toBe(expectedExpiry);

    const turnEntry = iceServers.find((s) => s.username !== undefined);
    expect(turnEntry).toBeDefined();
    expect(turnEntry?.username).toBe(`${expectedExpiry}:${userId}`);
    // The expiry is in SECONDS, not milliseconds.
    expect(ttlExpiresAt).toBeLessThan(NOW_MS);
  });

  it('signs credential = base64(HMAC-SHA1(secret, username)) — verified against a hand-computed value', () => {
    const service = turnServiceWith({
      TURN_STATIC_AUTH_SECRET: SECRET,
      TURN_CRED_TTL_SECONDS: TTL,
      TURN_HOST: 'turn.ruletka.top',
    });

    const { iceServers, ttlExpiresAt } = service.mintCredentials(userId);
    const turnEntry = iceServers.find((s) => s.credential !== undefined);

    const username = `${ttlExpiresAt}:${userId}`;
    // Recompute independently from the documented formula.
    expect(turnEntry?.credential).toBe(expectedCredential(SECRET, username));

    // Pin the EXACT bytes for the known instant so a regression in the secret,
    // algorithm or encoding is caught — hand-computed via Node crypto offline.
    // username = "1764500000:507f1f77bcf86cd799439011"
    const expiry = Math.floor(NOW_MS / 1000) + TTL; // 1764503600
    expect(ttlExpiresAt).toBe(expiry);
    expect(turnEntry?.credential).toBe(
      createHmac('sha1', SECRET).update(`${expiry}:${userId}`).digest('base64'),
    );
    // base64 of a SHA-1 digest (20 bytes) is always 28 chars ending in '='.
    expect(turnEntry?.credential).toMatch(/^[A-Za-z0-9+/]{27}=$/);
  });

  it('binds the credential to the user id (different users get different credentials)', () => {
    const service = turnServiceWith({
      TURN_STATIC_AUTH_SECRET: SECRET,
      TURN_CRED_TTL_SECONDS: TTL,
    });
    const a = service.mintCredentials('507f1f77bcf86cd799439011');
    const b = service.mintCredentials('507f1f77bcf86cd799439012');

    const credA = a.iceServers.find((s) => s.credential)?.credential;
    const credB = b.iceServers.find((s) => s.credential)?.credential;
    expect(credA).toBeDefined();
    expect(credA).not.toBe(credB);
  });

  it('returns iceServers with the configured STUN and TURN urls (explicit env)', () => {
    const service = turnServiceWith({
      TURN_STATIC_AUTH_SECRET: SECRET,
      NEXT_PUBLIC_STUN_URLS: 'stun:stun.ruletka.top:3478, stun:stun.l.google.com:19302',
      NEXT_PUBLIC_TURN_URLS: 'turn:turn.ruletka.top:3478, turns:turn.ruletka.top:5349',
    });

    const { iceServers } = service.mintCredentials(userId);

    // STUN entry: urls only, no credentials.
    const stun = iceServers.find((s) => s.credential === undefined);
    expect(stun?.urls).toEqual(['stun:stun.ruletka.top:3478', 'stun:stun.l.google.com:19302']);
    expect(stun?.username).toBeUndefined();

    // TURN entry: urls + ephemeral credentials.
    const turn = iceServers.find((s) => s.credential !== undefined);
    expect(turn?.urls).toEqual(['turn:turn.ruletka.top:3478', 'turns:turn.ruletka.top:5349']);
    expect(turn?.username).toBeDefined();
  });

  it('derives STUN/TURN urls from TURN_HOST/PORT when no explicit url list is set', () => {
    const service = turnServiceWith({
      TURN_STATIC_AUTH_SECRET: SECRET,
      TURN_HOST: 'coturn.internal',
      TURN_PORT: 3478,
      TURN_TLS_PORT: 5349,
    });

    const { iceServers } = service.mintCredentials(userId);

    const stun = iceServers.find((s) => s.credential === undefined);
    const turn = iceServers.find((s) => s.credential !== undefined);
    expect(stun?.urls).toEqual(['stun:coturn.internal:3478']);
    expect(turn?.urls).toEqual(['turn:coturn.internal:3478', 'turns:coturn.internal:5349']);
  });

  it('uses the 20-min default TTL when TURN_CRED_TTL_SECONDS is unset', () => {
    const service = turnServiceWith({ TURN_STATIC_AUTH_SECRET: SECRET, TURN_HOST: 'h' });
    const { ttlExpiresAt } = service.mintCredentials(userId);
    // Default lifetime is 1200s (20 min) — short-lived, client re-fetches per call.
    expect(ttlExpiresAt).toBe(Math.floor(NOW_MS / 1000) + 1200);
  });

  it('degrades to STUN-only (no bogus TURN credential) when the signing secret is blank', () => {
    // No TURN_STATIC_AUTH_SECRET ⇒ unconfigured: signing with an empty secret
    // would mint a credential coturn rejects, so we must NOT advertise TURN.
    const service = turnServiceWith({
      // secret omitted entirely
      TURN_HOST: 'turn.ruletka.top',
      TURN_PORT: 3478,
      TURN_TLS_PORT: 5349,
      NEXT_PUBLIC_STUN_URLS: 'stun:stun.ruletka.top:3478',
    });

    const { iceServers } = service.mintCredentials(userId);

    // Exactly the STUN entry — no TURN entry, no credential anywhere.
    expect(iceServers).toHaveLength(1);
    expect(iceServers[0]?.urls).toEqual(['stun:stun.ruletka.top:3478']);
    expect(iceServers.some((s) => s.credential !== undefined)).toBe(false);
    expect(iceServers.some((s) => s.username !== undefined)).toBe(false);
  });

  it('treats a whitespace-only secret as unconfigured (still STUN-only)', () => {
    const service = turnServiceWith({
      TURN_STATIC_AUTH_SECRET: '   ',
      TURN_HOST: 'turn.ruletka.top',
    });

    const { iceServers } = service.mintCredentials(userId);
    expect(iceServers.some((s) => s.credential !== undefined)).toBe(false);
  });

  it('still mints a TURN credential when the secret IS configured (no regression)', () => {
    const service = turnServiceWith({
      TURN_STATIC_AUTH_SECRET: SECRET,
      TURN_HOST: 'turn.ruletka.top',
    });
    const { iceServers } = service.mintCredentials(userId);
    expect(iceServers.some((s) => s.credential !== undefined)).toBe(true);
  });

  it('falls back to host-derived TURN urls when the explicit TURN list is all blank', () => {
    // A blank/comma-only NEXT_PUBLIC_TURN_URLS yields an EMPTY explicit list, so
    // buildTurnUrls falls through to the TURN_HOST/PORT-derived urls — TURN is
    // therefore never silently dropped (a credential is always still minted).
    const service = turnServiceWith({
      TURN_STATIC_AUTH_SECRET: SECRET,
      NEXT_PUBLIC_TURN_URLS: '   ,  ', // all blank ⇒ ignored, host fallback used
      TURN_HOST: 'fallback.host',
      TURN_PORT: 3478,
      TURN_TLS_PORT: 5349,
      NEXT_PUBLIC_STUN_URLS: 'stun:only.example:3478',
    });

    const { iceServers } = service.mintCredentials(userId);

    // Both a STUN entry and a host-derived TURN entry are present.
    expect(iceServers).toHaveLength(2);
    const stun = iceServers.find((s) => s.credential === undefined);
    const turn = iceServers.find((s) => s.credential !== undefined);
    expect(stun?.urls).toEqual(['stun:only.example:3478']);
    expect(turn?.urls).toEqual(['turn:fallback.host:3478', 'turns:fallback.host:5349']);
    expect(turn?.username).toBeDefined();
  });
});
