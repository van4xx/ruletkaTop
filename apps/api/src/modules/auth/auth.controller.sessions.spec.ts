import { ConfigService } from '@nestjs/config';
import type { JwtPayload } from '@ruletka/shared-types';
import type { Request } from 'express';

import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';

/**
 * Session-management routes (GET/DELETE /auth/sessions) identify the requesting
 * device from the refresh token so they can flag `current` and let "revoke other
 * sessions" KEEP the caller's own session. Browsers send the httpOnly cookie;
 * non-browser clients (the Flutter app has no cookie jar) send an
 * `x-refresh-token` header. This locks in the cookie → header → none precedence
 * — the header path is what stops mobile "revoke others" from logging the device
 * out everywhere (the adversarial-review HIGH finding).
 */
describe('AuthController session-token resolution (cookie → x-refresh-token → none)', () => {
  // Mirrors the controller-private REFRESH_COOKIE const.
  const REFRESH_COOKIE = 'ruletka_rt';
  const user = { sub: 'user-1' } as JwtPayload;

  let controller: AuthController;
  let authService: { listSessions: jest.Mock; revokeOtherSessions: jest.Mock };

  const req = (cookies?: Record<string, string>, headers?: Record<string, string>): Request =>
    ({ cookies: cookies ?? {}, headers: headers ?? {} }) as unknown as Request;

  beforeEach(() => {
    authService = {
      listSessions: jest.fn().mockResolvedValue([]),
      revokeOtherSessions: jest.fn().mockResolvedValue(undefined),
    };
    controller = new AuthController(
      authService as unknown as AuthService,
      { get: jest.fn() } as unknown as ConfigService,
    );
  });

  it('listSessions: resolves the device from the x-refresh-token header when there is no cookie (mobile)', async () => {
    await controller.listSessions(user, req({}, { 'x-refresh-token': 'rt-header' }));
    expect(authService.listSessions).toHaveBeenCalledWith('user-1', 'rt-header');
  });

  it('listSessions: the httpOnly cookie still takes precedence over the header', async () => {
    await controller.listSessions(
      user,
      req({ [REFRESH_COOKIE]: 'rt-cookie' }, { 'x-refresh-token': 'rt-header' }),
    );
    expect(authService.listSessions).toHaveBeenCalledWith('user-1', 'rt-cookie');
  });

  it('listSessions: neither cookie nor header → undefined (no current device flagged)', async () => {
    await controller.listSessions(user, req({}, {}));
    expect(authService.listSessions).toHaveBeenCalledWith('user-1', undefined);
  });

  it('revokeOtherSessions: passes the header token so the server KEEPS this device (not "log out everywhere")', async () => {
    await controller.revokeOtherSessions(user, req({}, { 'x-refresh-token': 'rt-header' }));
    expect(authService.revokeOtherSessions).toHaveBeenCalledWith('user-1', 'rt-header');
  });

  it('revokeOtherSessions: cookie wins over header', async () => {
    await controller.revokeOtherSessions(
      user,
      req({ [REFRESH_COOKIE]: 'rt-cookie' }, { 'x-refresh-token': 'rt-header' }),
    );
    expect(authService.revokeOtherSessions).toHaveBeenCalledWith('user-1', 'rt-cookie');
  });

  it('revokeOtherSessions: with no token at all, still calls through with undefined', async () => {
    await controller.revokeOtherSessions(user, req({}, {}));
    expect(authService.revokeOtherSessions).toHaveBeenCalledWith('user-1', undefined);
  });
});
