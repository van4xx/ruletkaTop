import 'reflect-metadata';

import { AuthController } from './auth.controller';
import { AUTH_THROTTLER, REFRESH_THROTTLER } from '../../common/throttler/throttler.constants';

/**
 * AuthController rate-limit wiring tests.
 *
 * These assert the THROTTLER metadata the `@Throttle` / `@SkipThrottle`
 * decorators stamp on the controller + handlers — the mechanism Nest's
 * ThrottlerGuard reads at request time. The bug being guarded against: the
 * silent `/auth/refresh` call rode the STRICT per-IP `auth` bucket (10/min),
 * so heavy navigation 429'd it and the web mistook that for a session-expiry →
 * spurious logout. The fix exempts refresh from the `auth` bucket and gives it
 * its own generous `refresh` bucket.
 *
 * `@nestjs/throttler` v6 stamps metadata under keys `THROTTLER:<X><name>` (TTL,
 * LIMIT, SKIP, …) — see the package's `throttler.constants`. We read those keys
 * directly with `Reflect.getMetadata`, no Nest test harness required.
 */
const THROTTLER_SKIP = 'THROTTLER:SKIP';
const THROTTLER_TTL = 'THROTTLER:TTL';

describe('AuthController throttle wiring', () => {
  it('applies the STRICT auth throttler at the controller level', () => {
    // The class-level `@Throttle({ [AUTH_THROTTLER]: {} })` registers the auth
    // bucket (an empty options object → falls back to the registered ttl/limit,
    // so the metadata value is `undefined` but the KEY is present).
    const hasAuthTtlKey = Reflect.hasMetadata(THROTTLER_TTL + AUTH_THROTTLER, AuthController);
    expect(hasAuthTtlKey).toBe(true);
  });

  it('EXEMPTS /auth/refresh from the strict auth throttler bucket', () => {
    const refreshHandler = AuthController.prototype.refresh;
    const skipAuth = Reflect.getMetadata(THROTTLER_SKIP + AUTH_THROTTLER, refreshHandler);
    expect(skipAuth).toBe(true);
  });

  it('routes /auth/refresh through the generous refresh throttler bucket', () => {
    const refreshHandler = AuthController.prototype.refresh;
    // The refresh bucket is activated on the handler (empty options → the key is
    // present even though the ttl value defers to the registered default).
    const hasRefreshTtlKey = Reflect.hasMetadata(THROTTLER_TTL + REFRESH_THROTTLER, refreshHandler);
    expect(hasRefreshTtlKey).toBe(true);
  });

  it('does NOT exempt the strict login/register routes from the auth bucket', () => {
    // Sanity: only refresh is exempted. login carries no per-handler SKIP for the
    // auth bucket, so it stays on the strict limiter.
    const loginHandler = AuthController.prototype.login;
    const skipAuth = Reflect.getMetadata(THROTTLER_SKIP + AUTH_THROTTLER, loginHandler);
    expect(skipAuth).toBeUndefined();
  });
});
