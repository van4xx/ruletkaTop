/**
 * Rate-limiting tunables and named-throttler keys for the global
 * {@link ThrottlerModule} setup.
 *
 * `@nestjs/throttler` v6 expresses `ttl` in MILLISECONDS. Two throttlers are
 * configured app-wide:
 *  - `default` — a generous per-IP global ceiling guarding every route.
 *  - {@link AUTH_THROTTLER} — a STRICT per-IP limit the identity module applies to
 *    credential endpoints (login / register / refresh) via
 *    `@Throttle({ [AUTH_THROTTLER]: { limit, ttl } })`.
 */

/** One minute in milliseconds — the window both throttlers use by default. */
export const ONE_MINUTE_MS = 60_000;

/** Named throttler key for strict auth-endpoint limiting. */
export const AUTH_THROTTLER = 'auth';

/** Global default: requests per IP per minute (overridable via env). */
export const DEFAULT_THROTTLE_LIMIT = 120;

/** Strict auth default: requests per IP per minute (overridable via env). */
export const AUTH_THROTTLE_LIMIT = 10;
