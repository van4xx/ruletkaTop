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

/**
 * Named throttler key for the token-REFRESH endpoint. Refresh is fired silently
 * and often (proactive pre-expiry refresh, cold-start boot, refresh-on-resume),
 * so it gets its OWN generous bucket instead of riding the strict {@link
 * AUTH_THROTTLER} login/register limit. A 429 here used to cascade into a spurious
 * client logout (the web treated it as session-expired), so the limit is set high
 * enough that ordinary heavy navigation never trips it.
 */
export const REFRESH_THROTTLER = 'refresh';

/** Global default: requests per IP per minute (overridable via env). */
export const DEFAULT_THROTTLE_LIMIT = 120;

/** Strict auth default: requests per IP per minute (overridable via env). */
export const AUTH_THROTTLE_LIMIT = 10;

/**
 * Generous refresh default: requests per IP per minute (overridable via env).
 * Sized well above any realistic per-client refresh rate (proactive + reactive +
 * resume) so a burst of navigation never 429s the silent token rotation. Shared
 * per-IP, so it also tolerates several tabs / devices behind one NAT.
 */
export const REFRESH_THROTTLE_LIMIT = 60;
