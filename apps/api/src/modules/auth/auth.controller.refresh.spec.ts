import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import type { AuthResponse } from '@ruletka/shared-types';
import type { Request, Response } from 'express';

import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';

/**
 * Transport-aware refresh-token rotation (the second-audit HIGH finding).
 *
 * The server rotates the refresh token on every `/auth/refresh`. A BROWSER
 * re-reads the rotated token from the httpOnly cookie, so the JSON body's
 * `refreshToken` is blanked (XSS can't read it). But the Flutter app uses Dio
 * with NO cookie jar — it can only see the body. If we blank the body for that
 * client it keeps the OLD token, and the NEXT refresh replays a now-rotated
 * token → the reuse-detection burns the whole family → every native session
 * dies ~15min in. So a cookie-less refresh (body or `x-refresh-token` header)
 * MUST get the rotated token echoed in the body; the cookie path still blanks it.
 */
describe('AuthController.refresh — transport-aware rotation', () => {
  const REFRESH_COOKIE = 'ruletka_rt';
  const ROTATED = 'rotated-refresh-token';

  let controller: AuthController;
  let authService: { refresh: jest.Mock };
  let res: Response;

  /** A passthrough Response stub capturing set cookies. */
  function makeRes(): Response {
    return {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    } as unknown as Response;
  }

  const req = (cookies?: Record<string, string>, headers?: Record<string, string>): Request =>
    ({ cookies: cookies ?? {}, headers: headers ?? {}, ip: '127.0.0.1' }) as unknown as Request;

  beforeEach(() => {
    // The service always returns the ROTATED token (rotation already happened).
    const result: AuthResponse = {
      user: {
        id: '507f1f77bcf86cd799439011',
        email: 'a@b.co',
        role: 'user',
        nickname: 'nick',
        isPremium: false,
      },
      tokens: { accessToken: 'access-token', refreshToken: ROTATED },
    };
    authService = { refresh: jest.fn().mockResolvedValue(result) };
    res = makeRes();
    // `get(key, default)` must honour the default (the controller reads
    // JWT_REFRESH_TTL/NODE_ENV/etc. through it when setting the rotated cookie).
    const config = {
      get: jest.fn((_key: string, def?: unknown) => def),
    } as unknown as ConfigService;
    controller = new AuthController(authService as unknown as AuthService, config);
  });

  it('BODY credential (mobile, no cookie): returns the rotated refreshToken in the JSON body', async () => {
    const out = await controller.refresh({ refreshToken: 'old-token' }, req({}, {}), res);

    // The cookie-less client must receive the rotated token, else it replays the
    // old one and burns the rotation family.
    expect(out.tokens.refreshToken).toBe(ROTATED);
    expect(out.tokens.accessToken).toBe('access-token');
    // The service was called with the body token.
    expect(authService.refresh).toHaveBeenCalledWith('old-token', expect.any(Object));
    // The cookie is still rotated (harmless for a client that ignores it).
    expect(res.cookie).toHaveBeenCalledWith(REFRESH_COOKIE, ROTATED, expect.any(Object));
  });

  it('HEADER credential (mobile, no cookie): returns the rotated refreshToken in the JSON body', async () => {
    const out = await controller.refresh({}, req({}, { 'x-refresh-token': 'old-header-token' }), res);

    expect(out.tokens.refreshToken).toBe(ROTATED);
    expect(authService.refresh).toHaveBeenCalledWith('old-header-token', expect.any(Object));
  });

  it('COOKIE credential (browser): BLANKS the refreshToken in the JSON body', async () => {
    const out = await controller.refresh({}, req({ [REFRESH_COOKIE]: 'cookie-token' }, {}), res);

    // The browser re-reads from the rotated httpOnly cookie; the body must not
    // leak the refresh token to JavaScript.
    expect(out.tokens.refreshToken).toBe('');
    expect(out.tokens.accessToken).toBe('access-token');
    expect(authService.refresh).toHaveBeenCalledWith('cookie-token', expect.any(Object));
    // The rotated cookie is still set.
    expect(res.cookie).toHaveBeenCalledWith(REFRESH_COOKIE, ROTATED, expect.any(Object));
  });

  it('COOKIE wins over a body/header credential and still blanks the body', async () => {
    const out = await controller.refresh(
      { refreshToken: 'body-token' },
      req({ [REFRESH_COOKIE]: 'cookie-token' }, { 'x-refresh-token': 'header-token' }),
      res,
    );

    // Cookie present ⇒ browser path ⇒ blank the body, even though a body/header
    // token was also supplied.
    expect(out.tokens.refreshToken).toBe('');
    expect(authService.refresh).toHaveBeenCalledWith('cookie-token', expect.any(Object));
  });

  it('rejects when no refresh token is presented anywhere', async () => {
    await expect(controller.refresh({}, req({}, {}), res)).rejects.toThrow(UnauthorizedException);
    expect(authService.refresh).not.toHaveBeenCalled();
  });
});
