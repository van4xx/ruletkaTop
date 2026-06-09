import { ConfigService } from '@nestjs/config';
import type { AuthResponse, LoginDto, RegisterDto } from '@ruletka/shared-types';
import type { Request, Response } from 'express';

import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';

/**
 * Transport-aware token delivery on `login` / `register` (the wave-3 CRITICAL).
 *
 * `refresh` was already made transport-aware (it echoes the rotated refresh
 * token in the body for cookie-less clients). But `login`/`register` blanked the
 * body unconditionally, so the Flutter app (Dio, NO cookie jar) received
 * `refreshToken:''` on the very first auth call → it never had a refresh token
 * to present → its first `/auth/refresh` had nothing, and the native session
 * died ~15min in (when the short-lived access token expired).
 *
 * The fix: a COOKIE-LESS native client is detected (explicit
 * `x-refresh-transport: body` header, or the absence of a browser `Origin`) and
 * gets the refresh token in the JSON body; a BROWSER (cookie present / `Origin`
 * set) keeps the body blanked and re-reads the token from the httpOnly cookie.
 */
describe('AuthController login/register — transport-aware token delivery', () => {
  const REFRESH_COOKIE = 'ruletka_rt';
  const PRESENCE_COOKIE = 'ruletka_auth';
  const MINTED_REFRESH = 'minted-refresh-token';
  const ACCESS = 'access-token';

  let controller: AuthController;
  let authService: { login: jest.Mock; register: jest.Mock };
  let res: Response;

  /** A passthrough Response stub capturing set cookies. */
  function makeRes(): Response {
    return {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    } as unknown as Response;
  }

  /**
   * A minimal Request stub. `headers` carries the transport signal (the mobile
   * `x-refresh-transport: body`, or a browser `origin`). A bare `{}` headers
   * object models a non-browser client (no `Origin`) — i.e. the heuristic path.
   */
  const req = (headers: Record<string, string> = {}): Request =>
    ({ cookies: {}, headers, ip: '127.0.0.1' }) as unknown as Request;

  const loginDto: LoginDto = { email: 'a@b.co', password: 'pw' };
  const registerDto = {
    email: 'a@b.co',
    password: 'Sup3r-secret!',
    nickname: 'nick',
    gender: 'male',
    birthDate: '2000-01-01',
  } as unknown as RegisterDto;

  /** A browser `Origin` header (web app on its own origin behind CORS). */
  const BROWSER = { origin: 'https://ruletka.top' };
  /** The explicit native opt-in the mobile app sends. */
  const MOBILE = { 'x-refresh-transport': 'body' };

  beforeEach(() => {
    const result: AuthResponse = {
      user: {
        id: '507f1f77bcf86cd799439011',
        email: 'a@b.co',
        role: 'user',
        nickname: 'nick',
        isPremium: false,
      },
      tokens: { accessToken: ACCESS, refreshToken: MINTED_REFRESH },
    };
    authService = {
      login: jest.fn().mockResolvedValue(result),
      register: jest.fn().mockResolvedValue(result),
    };
    res = makeRes();
    const config = {
      get: jest.fn((_key: string, def?: unknown) => def),
    } as unknown as ConfigService;
    controller = new AuthController(authService as unknown as AuthService, config);
  });

  // ── login ─────────────────────────────────────────────────────────────────

  it('login WITH the mobile transport header returns a NON-EMPTY refreshToken in the body', async () => {
    const out = await controller.login(loginDto, req(MOBILE), res);

    expect(out.tokens.refreshToken).toBe(MINTED_REFRESH);
    expect(out.tokens.accessToken).toBe(ACCESS);
    // The cookie is still set (harmless for a client that ignores it).
    expect(res.cookie).toHaveBeenCalledWith(REFRESH_COOKIE, MINTED_REFRESH, expect.any(Object));
  });

  it('login WITHOUT the header (browser, Origin set) BLANKS the body and SETS the cookie', async () => {
    const out = await controller.login(loginDto, req(BROWSER), res);

    // Browser re-reads the refresh token from the httpOnly cookie; the body must
    // not leak it to JavaScript.
    expect(out.tokens.refreshToken).toBe('');
    expect(out.tokens.accessToken).toBe(ACCESS);
    expect(res.cookie).toHaveBeenCalledWith(REFRESH_COOKIE, MINTED_REFRESH, expect.any(Object));
    expect(res.cookie).toHaveBeenCalledWith(PRESENCE_COOKIE, '1', expect.any(Object));
  });

  it('login from a non-browser client (no Origin, no header) still exposes the body token', async () => {
    // Heuristic fallback: no browser `Origin` ⇒ cookie-less native client.
    const out = await controller.login(loginDto, req(), res);
    expect(out.tokens.refreshToken).toBe(MINTED_REFRESH);
  });

  // ── register ────────────────────────────────────────────────────────────────

  it('register WITH the mobile transport header returns a NON-EMPTY refreshToken in the body', async () => {
    const out = await controller.register(registerDto, req(MOBILE), res);

    expect(out.tokens.refreshToken).toBe(MINTED_REFRESH);
    expect(out.tokens.accessToken).toBe(ACCESS);
    expect(res.cookie).toHaveBeenCalledWith(REFRESH_COOKIE, MINTED_REFRESH, expect.any(Object));
  });

  it('register WITHOUT the header (browser, Origin set) BLANKS the body and SETS the cookie', async () => {
    const out = await controller.register(registerDto, req(BROWSER), res);

    expect(out.tokens.refreshToken).toBe('');
    expect(out.tokens.accessToken).toBe(ACCESS);
    expect(res.cookie).toHaveBeenCalledWith(REFRESH_COOKIE, MINTED_REFRESH, expect.any(Object));
    expect(res.cookie).toHaveBeenCalledWith(PRESENCE_COOKIE, '1', expect.any(Object));
  });

  it('an explicit transport header wins even when a browser Origin is also present', async () => {
    // A native client behind a proxy that injects Origin still gets the body
    // token because the explicit opt-in is authoritative.
    const out = await controller.login(loginDto, req({ ...BROWSER, ...MOBILE }), res);
    expect(out.tokens.refreshToken).toBe(MINTED_REFRESH);
  });
});
