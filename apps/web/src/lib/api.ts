/**
 * Typed REST client for the ruletka.top NestJS API.
 *
 * - `fetch`-based, isomorphic (works in RSC, route handlers and the browser).
 * - Injects a bearer access token when present.
 * - Includes a single-flight refresh stub: on a `401` it attempts to refresh
 *   the access token once, then retries the original request. The actual token
 *   persistence strategy (httpOnly cookie vs. in-memory) is owned by the auth
 *   feature; this module exposes hooks so that wiring stays in one place.
 *
 * Response shapes are taken from `@ruletka/shared-types` (the contract).
 */
import type {
  AchievementsCatalogue,
  ApiError,
  AuthResponse,
  AuthTokens,
  CoinPackage,
  CoinTransaction,
  CountryCode,
  DailyBonusClaimResponse,
  DailyBonusState,
  FriendRequestsResponse,
  Gender,
  Gift,
  KycMeResponse,
  KycStartResponse,
  LeaderboardMetric,
  LeaderboardResponse,
  LoginDto,
  MyAchievements,
  Notification as StoredNotificationRecord,
  PaginationMeta,
  PremiumPlan,
  PublicAchievements,
  PublicProfile,
  PublicStatus,
  PushSubscriptionDto,
  ReferralBindDto,
  ReferralListResponse,
  ReferralLookupResponse,
  ReferralMeResponse,
  ReferralTier,
  RegisterDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
  TopPlacement,
  UnreadCount,
  UpdateProfileDto,
  VerifyEmailDto,
  Wallet,
} from '@ruletka/shared-types';

/** Base URL of the API, e.g. `http://localhost:4000/api`. */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

// ──────────────────────────── Token store ─────────────────────────────
/**
 * Pluggable ACCESS-token storage.
 *
 * SECURITY: the refresh token is NEVER held here — it lives only in an
 * httpOnly, SameSite=Strict cookie set by the API (`/auth/login|register|
 * refresh`), so JavaScript (and therefore any XSS payload) cannot read it. The
 * short-lived access token is kept IN MEMORY only (never localStorage), so a
 * full page reload drops it and the app re-acquires one via a cookie-based
 * `/auth/refresh` on boot.
 *
 * `getRefreshToken` is retained on the interface for backward compatibility but
 * always returns `null` under the cookie strategy (refresh is transport-level).
 * The auth feature can replace the store via {@link configureTokenStore}.
 */
export interface TokenStore {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  setTokens(tokens: AuthTokens | null): void;
}

function createMemoryTokenStore(): TokenStore {
  let access: string | null = null;
  return {
    getAccessToken: () => access,
    // Refresh token is cookie-only; never exposed to JS.
    getRefreshToken: () => null,
    setTokens: (tokens) => {
      access = tokens?.accessToken ?? null;
    },
  };
}

let tokenStore: TokenStore = createMemoryTokenStore();

/**
 * Non-httpOnly presence marker the API sets alongside the refresh cookie
 * (`ruletka_auth=1`). It tells the client "a session exists" WITHOUT exposing
 * any token — used purely to decide whether a cold-start request should
 * proactively refresh before firing (see {@link performRequest}).
 */
const PRESENCE_COOKIE = 'ruletka_auth';

/** True when the browser holds the session-presence marker cookie. */
function hasSessionCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((c) => c.startsWith(`${PRESENCE_COOKIE}=`));
}

/** Override the token store (call once during app/auth bootstrap). */
export function configureTokenStore(store: TokenStore): void {
  tokenStore = store;
}

/** Imperatively set or clear the current auth tokens (access token only). */
export function setAuthTokens(tokens: AuthTokens | null): void {
  tokenStore.setTokens(tokens);
  // Keep the proactive-refresh timer in lock-step with the live token: a fresh
  // token (re)schedules a silent refresh just before its `exp`; clearing the
  // token cancels it. This keeps a valid access token in memory continuously, so
  // the first wave of requests after an idle period goes out authenticated
  // instead of 401-then-refresh-retrying (the most common felt "it logged me out").
  if (tokens?.accessToken) {
    // A live session again → re-arm the expiry latch so a LATER genuine expiry
    // can fire a fresh toast.
    sessionExpiredNotified = false;
    scheduleProactiveRefresh(tokens.accessToken);
  } else {
    stopProactiveRefresh();
  }
}

/**
 * Read the live access token from the configured store. Use this instead of
 * touching storage directly so token reads stay funneled through one place
 * (e.g. the socket handshake reads the token here).
 */
export function getAccessToken(): string | null {
  return tokenStore.getAccessToken();
}

// ─────────────────────────────── Errors ───────────────────────────────
/**
 * Stable, locale-agnostic failure codes carried by {@link ApiClientError}.
 * The UI maps these to localized copy (see `lib/error-message.ts`); never show
 * `error.message` raw to a user.
 *
 * - `network`  — the request never reached the server (offline / DNS / CORS /
 *   connection reset); `fetch` threw a `TypeError`. `status` is `0`.
 * - `http`     — the server answered with a non-2xx status (`status` is real).
 */
export type ApiErrorCode = 'network' | 'http';

/**
 * Error thrown for any failed API call, carrying a stable {@link ApiErrorCode}
 * and (for HTTP failures) the parsed {@link ApiError} body.
 *
 * Network failures get `status: 0` + `code: 'network'` so the UI can show a
 * friendly "couldn't reach the server" message instead of the raw, untranslated
 * `TypeError: Failed to fetch`.
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly body: ApiError | undefined;
  /** Stable failure category for UI mapping (never user-facing copy). */
  readonly code: ApiErrorCode;

  constructor(
    status: number,
    body: ApiError | undefined,
    fallbackMessage: string,
    code: ApiErrorCode = 'http',
  ) {
    const message = body
      ? Array.isArray(body.message)
        ? body.message.join(', ')
        : body.message
      : fallbackMessage;
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.body = body;
    this.code = code;
  }

  /** True when the request never reached the server (offline / unreachable). */
  get isNetworkError(): boolean {
    return this.code === 'network';
  }
}

/**
 * Normalise a thrown value from `fetch`/`performRequest` into an
 * {@link ApiClientError}. A `TypeError` from `fetch` means the request never
 * completed (offline, DNS, connection reset, CORS) → a `network` error with
 * `status: 0`. `AbortError`s (caller cancellation) and already-typed
 * `ApiClientError`s pass through untouched so retry/abort semantics are unchanged.
 */
function toApiClientError(error: unknown): unknown {
  if (error instanceof ApiClientError) return error;
  if (error instanceof TypeError) {
    return new ApiClientError(0, undefined, error.message, 'network');
  }
  return error;
}

// ─────────────────────────── Core request ─────────────────────────────
interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** JSON-serialisable request body. */
  json?: unknown;
  /**
   * Raw `multipart/form-data` body (e.g. a file upload). Mutually exclusive with
   * `json`. The browser sets the `Content-Type` (with the multipart boundary)
   * itself, so we deliberately do NOT set a content-type header for it. Requests
   * carrying a `formData` body are never de-duplicated or auto-retried (they are
   * non-idempotent and the body is single-use).
   */
  formData?: FormData;
  /** Query-string parameters. `undefined`/`null` values are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Skip bearer-token injection (e.g. for login/register). */
  skipAuth?: boolean;
  /**
   * Abort signal for cancel-on-unmount. When a query is cancelled (e.g. the
   * component unmounts or TanStack Query aborts a stale fetch) the in-flight
   * `fetch` is torn down and the promise rejects with an `AbortError`.
   */
  signal?: AbortSignal;
  /**
   * Opt OUT of automatic retry-with-backoff for this call (e.g. a non-idempotent
   * action the caller would rather fail fast). Retries are ON by default only
   * for idempotent methods (GET/HEAD) and never for aborted requests.
   */
  noRetry?: boolean;
  /**
   * Opt OUT of GET de-duplication (single-flight). By default concurrent
   * identical idempotent GETs share ONE network round-trip; set this when a
   * caller needs a guaranteed-fresh, independent fetch.
   */
  noDedupe?: boolean;
  /** Internal flag to prevent infinite refresh loops. */
  _isRetry?: boolean;
}

// ───────────────────────── Retry / backoff tuning ─────────────────────
/** Max automatic retries for transient failures (network blips, 5xx). */
const MAX_RETRIES = 2;
/** Base backoff (ms); grows exponentially with full jitter. */
const RETRY_BASE_MS = 300;
/** Cap on any single backoff wait (ms). */
const RETRY_MAX_MS = 4_000;
/** Methods safe to retry/de-dup automatically (idempotent by HTTP semantics). */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Resolve after `ms`, rejecting early (as an abort) if `signal` fires. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** True for errors worth retrying: network/connection failures and 5xx. */
function isRetryable(error: unknown): boolean {
  if (error instanceof ApiClientError) {
    // A `network` failure (fetch threw a TypeError → the request never completed:
    // DNS, offline, connection reset) is transient and worth a retry, as are 5xx.
    return error.code === 'network' || (error.status >= 500 && error.status < 600);
  }
  // A bare TypeError from fetch (e.g. from a path not yet normalised) is also a
  // never-completed request. AbortErrors are explicitly NOT retried (caller intent).
  return error instanceof TypeError;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path.replace(/^\//, ''), `${API_BASE_URL.replace(/\/$/, '')}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

// ───────────────────────── Refresh outcome ────────────────────────────
/**
 * Why a refresh attempt did NOT yield a token. Lets callers (boot, the 401
 * retry) tell a TRUE rejection — the refresh cookie is gone/invalid, the only
 * real "your session is over" signal — apart from a TRANSIENT failure (offline,
 * 5xx, cold API) that should be retried rather than logging the user out.
 *
 * - `unauthorized` — the server answered `401` (refresh cookie missing/expired/
 *   revoked / reuse-detected). Clear auth.
 * - `transient`    — the request never completed (network) or the server 5xx'd.
 *   Keep the session; retry.
 */
export type RefreshFailureReason = 'unauthorized' | 'transient';

/** Result of a refresh attempt: success carries no reason; failure carries one. */
export type RefreshResult = { ok: true } | { ok: false; reason: RefreshFailureReason };

/** In-flight refresh promise, so concurrent 401s share one refresh round-trip. */
let refreshInFlight: Promise<RefreshResult> | null = null;

// ───────────────────── Session-expiry notification ────────────────────
/**
 * Subscribers notified when a refresh is HARD-rejected (`401`) — the one true
 * "your session is over" signal, as opposed to a transient network/5xx blip
 * (which keeps the session and retries). This lets the React layer surface a
 * localized "session expired, sign in again" toast and tear the session down in
 * ONE place, without `api.ts` importing the store, i18n or the toast lib.
 *
 * Fired at most once per expiry burst (a `notified` latch is reset the moment a
 * fresh token is stored), so a wave of concurrent 401s yields a single toast.
 */
type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();
let sessionExpiredNotified = false;

/**
 * Subscribe to hard session-expiry. Returns an unsubscribe fn. Used by a small
 * client component (mounted at the app root) to show the expiry toast + clear
 * auth. Safe in SSR (the set simply never fires there).
 */
export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

/** Emit the hard-expiry signal once per burst. */
function emitSessionExpired(): void {
  if (sessionExpiredNotified) return;
  sessionExpiredNotified = true;
  for (const listener of sessionExpiredListeners) {
    try {
      listener();
    } catch {
      /* a misbehaving listener must not break the refresh path */
    }
  }
}

/**
 * Exchange the httpOnly refresh COOKIE for a fresh access token.
 *
 * Sends no body and no bearer — the refresh token rides along as a cookie
 * (`credentials: 'include'`), and the API rotates that cookie in its response.
 * The new access token (response body) is stored in memory. Concurrent callers
 * share a single in-flight round-trip.
 *
 * Returns a {@link RefreshResult}: `{ ok: true }` on success, otherwise a reason
 * distinguishing a hard `401` (`unauthorized` → clear auth) from a network/5xx
 * blip (`transient` → keep the session, retry). On a hard 401 the in-memory
 * token is cleared; on a transient failure it is LEFT ALONE so a still-valid
 * cookie can succeed on the next attempt.
 */
async function tryRefresh(): Promise<RefreshResult> {
  if (!refreshInFlight) {
    refreshInFlight = (async (): Promise<RefreshResult> => {
      try {
        const res = await fetch(buildUrl('/auth/refresh'), {
          method: 'POST',
          // Send the httpOnly refresh cookie; receive a rotated one.
          credentials: 'include',
        });
        if (!res.ok) {
          // Distinguish a TRANSIENT failure (keep the session, retry) from a HARD
          // rejection (the refresh credential is no longer honoured → clear auth).
          //
          // - 5xx           → server-side blip; transient.
          // - 429           → the HTTP rate limiter throttled the refresh. This is
          //   NOT a session-expiry: under heavy navigation a burst of refreshes
          //   could 429, and treating it as `unauthorized` here logged the user
          //   out mid-session. Keep the token, back off, retry.
          // - other 4xx (401/403/…) → the refresh cookie is missing/expired/
          //   revoked/reused: a true rejection, clear auth.
          if (res.status >= 500 || res.status === 429) {
            return { ok: false, reason: 'transient' };
          }
          setAuthTokens(null);
          emitSessionExpired();
          return { ok: false, reason: 'unauthorized' };
        }
        // The API returns an AuthResponse ({ user, tokens }); the refresh token
        // stays in the rotated httpOnly cookie, so only tokens.accessToken matters.
        const body = (await res.json()) as { tokens?: AuthTokens };
        const tokens = body.tokens;
        if (!tokens?.accessToken) {
          setAuthTokens(null);
          emitSessionExpired();
          return { ok: false, reason: 'unauthorized' };
        }
        setAuthTokens(tokens);
        return { ok: true };
      } catch {
        // `fetch` threw → the request never completed (offline / DNS / reset).
        // Transient: do NOT clear the token, so a recovered network can refresh.
        return { ok: false, reason: 'transient' };
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

/**
 * Public boot/rehydrate hook: attempt to acquire an access token from the
 * refresh cookie. Used on app load (there is no persisted access token to
 * restore — only the httpOnly cookie) and by the proactive scheduler. Returns
 * the full {@link RefreshResult} so the boot sequence can retry on `transient`
 * and clear only on `unauthorized`.
 */
export function refreshAccessToken(): Promise<RefreshResult> {
  return tryRefresh();
}

// ──────────────── Reactive (401-path) refresh retry tuning ─────────────
/**
 * Max extra refresh attempts on the transparent 401-retry path when the refresh
 * itself fails TRANSIENTLY (a 429 from the rate limiter, or a 5xx). Small and
 * fast: this sits inline on a user request, so it must not add noticeable
 * latency — it just absorbs a single throttled/blip'd refresh rather than
 * surfacing the 401 immediately.
 */
const REACTIVE_REFRESH_MAX_RETRIES = 2;
/** Base backoff (ms) for the reactive refresh retry; grows with full jitter. */
const REACTIVE_REFRESH_BASE_MS = 250;
/** Cap on any single reactive refresh backoff wait (ms). */
const REACTIVE_REFRESH_MAX_MS = 1_500;

/**
 * Refresh the access token, retrying with bounded backoff when the refresh
 * fails TRANSIENTLY (notably a `429` from the HTTP rate limiter under heavy
 * navigation, or a 5xx blip). A hard `unauthorized` returns immediately (no
 * point retrying a dead credential), and success returns at once. Used by the
 * transparent 401-retry path so a throttled refresh recovers instead of bubbling
 * the original 401 — which the UI would otherwise treat as a failed request.
 */
async function tryRefreshWithBackoff(signal?: AbortSignal): Promise<RefreshResult> {
  let result = await tryRefresh();
  for (
    let attempt = 0;
    attempt < REACTIVE_REFRESH_MAX_RETRIES && !result.ok && result.reason === 'transient';
    attempt += 1
  ) {
    const ceiling = Math.min(REACTIVE_REFRESH_MAX_MS, REACTIVE_REFRESH_BASE_MS * 2 ** attempt);
    await delay(Math.random() * ceiling, signal);
    result = await tryRefresh();
  }
  return result;
}

// ───────────────────────── Proactive refresh ──────────────────────────
/**
 * Decode a JWT's payload (the middle base64url segment) WITHOUT verifying the
 * signature — the server is the only authority on validity; here we just want
 * the `exp` claim to time a silent refresh. Returns `null` for anything that
 * isn't a well-formed three-part JWT with a numeric `exp`.
 */
function readJwtExpMs(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payloadSegment = parts[1];
  if (!payloadSegment) return null;
  try {
    // base64url → base64, then decode. `atob` exists in browsers and modern
    // Node; this scheduler only ever runs in the browser (timers are no-ops in
    // SSR because `setAuthTokens` is only called client-side after login/boot).
    const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function' ? atob(base64) : '';
    if (!json) return null;
    const payload = JSON.parse(json) as { exp?: unknown };
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

/** Lead time before `exp` at which we proactively refresh (60s). */
const PROACTIVE_REFRESH_LEAD_MS = 60_000;
/** Floor for the scheduled delay so a near-expiry token still defers briefly. */
const PROACTIVE_REFRESH_MIN_MS = 10_000;

/** Handle for the single pending proactive-refresh timer (browser only). */
let proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Cancel any pending proactive refresh. Safe to call repeatedly / in SSR. */
export function stopProactiveRefresh(): void {
  if (proactiveRefreshTimer !== null) {
    clearTimeout(proactiveRefreshTimer);
    proactiveRefreshTimer = null;
  }
}

/**
 * Schedule the next silent refresh ~`PROACTIVE_REFRESH_LEAD_MS` before the
 * current access token's `exp` (clamped to a sane minimum). Recomputed on every
 * successful refresh (each new token re-arms this), so a logged-in session keeps
 * a valid token in memory continuously. No-op outside the browser, or when the
 * token carries no decodable `exp`.
 */
function scheduleProactiveRefresh(accessToken: string): void {
  stopProactiveRefresh();
  if (typeof window === 'undefined') return;

  const expMs = readJwtExpMs(accessToken);
  if (expMs === null) return;

  const delayMs = Math.max(
    expMs - Date.now() - PROACTIVE_REFRESH_LEAD_MS,
    PROACTIVE_REFRESH_MIN_MS,
  );
  proactiveRefreshTimer = setTimeout(() => {
    proactiveRefreshTimer = null;
    // Fire and forget: success re-arms the timer via setAuthTokens; a transient
    // failure leaves the (still-valid) token in place, and the reactive 401 path
    // plus the resume listeners remain as backstops.
    void tryRefresh();
  }, delayMs);
}

/**
 * Refresh-on-resume: a tab suspended in the background (mobile especially) can
 * miss its scheduled proactive refresh and wake with a dead access token. When
 * the tab becomes visible or the network returns, refresh immediately IF a
 * session marker exists but no live access token is held — so the first request
 * after resume goes out authenticated instead of 401-ing. Registered once.
 */
let resumeListenersBound = false;
export function bindRefreshOnResume(): void {
  if (resumeListenersBound || typeof window === 'undefined') return;
  resumeListenersBound = true;

  const maybeRefresh = (): void => {
    if (!hasSessionCookie()) return;
    if (tokenStore.getAccessToken()) return;
    void tryRefresh();
  };

  window.addEventListener('online', maybeRefresh);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') maybeRefresh();
    });
  }
}

/**
 * A SINGLE network attempt: builds headers, sends the request, and performs at
 * most one transparent cookie-refresh + retry on a 401. This is the unit the
 * backoff layer re-invokes; it deliberately contains no retry loop of its own
 * (other than the one-shot 401 refresh, which is an auth concern, not a
 * transient-failure concern).
 */
async function performRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const { json, formData, query, skipAuth, _isRetry, signal, headers, ...init } = options;

  const finalHeaders = new Headers(headers);
  // For a FormData body the browser MUST set Content-Type (it appends the
  // multipart boundary), so we leave it unset. JSON bodies get the JSON type.
  if (formData === undefined && json !== undefined && !finalHeaders.has('content-type')) {
    finalHeaders.set('content-type', 'application/json');
  }
  if (!skipAuth) {
    let access = tokenStore.getAccessToken();
    // Cold-start fast path: no in-memory access token yet, but the presence
    // marker says a session exists → acquire the token via ONE shared refresh
    // BEFORE firing, instead of letting every boot query 401-then-refresh-retry.
    // Concurrent queries all await the same in-flight refresh (single-flight),
    // so the whole first wave goes out authenticated — zero spurious 401s.
    if (!access && !_isRetry && hasSessionCookie()) {
      await tryRefresh();
      access = tokenStore.getAccessToken();
    }
    if (access) finalHeaders.set('authorization', `Bearer ${access}`);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      ...init,
      headers: finalHeaders,
      signal,
      // Send cookies (httpOnly refresh on /auth routes; presence flag) and accept
      // Set-Cookie responses. Required for the cookie-based refresh strategy.
      credentials: 'include',
      body:
        formData !== undefined
          ? formData
          : json !== undefined
            ? JSON.stringify(json)
            : undefined,
    });
  } catch (error) {
    // `fetch` only throws when the request never completed: a `TypeError`
    // (offline / DNS / connection reset / CORS) or an `AbortError` (caller
    // cancellation). Normalise the former into a typed `network` ApiClientError
    // so the UI shows friendly copy instead of the raw "Failed to fetch"; let
    // AbortErrors propagate so cancellation/abort semantics stay unchanged.
    throw toApiClientError(error);
  }

  // Attempt one transparent refresh + retry on 401. (Unchanged hardened model:
  // the refresh token never leaves its httpOnly cookie; tryRefresh reads the
  // fresh access token from body.tokens.accessToken and stores it in memory.)
  // A TRANSIENT refresh failure (a 429 from the rate limiter under heavy
  // navigation, or a 5xx blip) is retried with bounded backoff before giving up,
  // so a throttled refresh recovers rather than surfacing the original 401. A
  // hard `unauthorized` (the api client already cleared auth + emitted expiry)
  // bubbles the 401 below — but never as a side effect of a mere 429.
  if (res.status === 401 && !skipAuth && !_isRetry) {
    const refreshed = await tryRefreshWithBackoff(signal);
    if (refreshed.ok) {
      return performRequest<T>(path, { ...options, _isRetry: true });
    }
  }

  if (!res.ok) {
    let body: ApiError | undefined;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      body = undefined;
    }
    throw new ApiClientError(res.status, body, `${res.status} ${res.statusText}`);
  }

  // 204 No Content → resolve as undefined.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Wraps {@link performRequest} with exponential backoff + full jitter for
 * transient failures (network errors and 5xx) on idempotent requests only.
 * Aborts (caller cancellation) and 4xx (including 401 after a failed refresh)
 * propagate immediately — they are not transient.
 */
async function requestWithRetry<T>(path: string, options: RequestOptions): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const retryEnabled = !options.noRetry && IDEMPOTENT_METHODS.has(method);

  let attempt = 0;

  while (true) {
    try {
      return await performRequest<T>(path, options);
    } catch (error) {
      const canRetry = retryEnabled && attempt < MAX_RETRIES && isRetryable(error);
      if (!canRetry) throw error;
      // Exponential backoff with full jitter: random in [0, base * 2^attempt],
      // capped — spreads retries so a recovering server isn't thundered.
      const ceiling = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
      await delay(Math.random() * ceiling, options.signal);
      attempt += 1;
    }
  }
}

/**
 * In-flight GET de-duplication (single-flight). Concurrent callers asking for
 * the SAME idempotent resource share one promise/round-trip; the entry is
 * cleared as soon as it settles. Skipped when the caller passes a `signal`
 * (their cancellation must not abort a request shared with others) or opts out.
 */
const inFlightGets = new Map<string, Promise<unknown>>();

function dedupeKey(path: string, options: RequestOptions): string {
  const method = (options.method ?? 'GET').toUpperCase();
  return `${method} ${buildUrl(path, options.query)}`;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const dedupable =
    !options.noDedupe &&
    options.signal === undefined &&
    options.json === undefined &&
    options.formData === undefined &&
    IDEMPOTENT_METHODS.has(method);

  if (!dedupable) {
    return requestWithRetry<T>(path, options);
  }

  const key = dedupeKey(path, options);
  const existing = inFlightGets.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = requestWithRetry<T>(path, options).finally(() => {
    inFlightGets.delete(key);
  });
  inFlightGets.set(key, promise);
  return promise;
}

// ───────────────────────── Typed endpoint groups ──────────────────────
/** A cursor-paginated list envelope returned by list endpoints. */
export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

/**
 * One page of `GET /profiles/search` results — the exact contract shape
 * (`ProfileSearchResult` on the API): a slice of public profiles plus a flat
 * cursor (`nextCursor` is `null` when exhausted) and `hasMore`. Note this is the
 * FLAT envelope (no nested `meta`), distinct from {@link Paginated}.
 */
export interface ProfileSearchPage {
  items: PublicProfile[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * The high-level API surface. Grouped by domain and fully typed against
 * `@ruletka/shared-types`. Feature agents extend this object as new endpoints
 * land — keep request/response types sourced from the contract.
 */
export const api = {
  /** Low-level escape hatch for endpoints not yet modelled here. */
  request,

  auth: {
    register: (dto: RegisterDto) =>
      request<AuthResponse>('/auth/register', { method: 'POST', json: dto, skipAuth: true }),
    login: (dto: LoginDto) =>
      request<AuthResponse>('/auth/login', { method: 'POST', json: dto, skipAuth: true }),
    me: () => request<PublicProfile>('/auth/me'),
    logout: () => request<void>('/auth/logout', { method: 'POST' }),
  },

  /**
   * Public, UNAUTHENTICATED operational status (`GET /public/status`). Surfaces
   * the live, admin-toggleable flags (`maintenanceMode` / `registrationOpen` /
   * `matchmakingEnabled`) so the chrome can show a maintenance banner and the
   * register form can pre-disable itself BEFORE hitting a gated endpoint. No
   * secret/env is exposed; the server still enforces every gate. `skipAuth` so it
   * works signed-out without dragging the bearer/refresh dance into it.
   */
  public: {
    status: (signal?: AbortSignal) =>
      request<PublicStatus>('/public/status', { skipAuth: true, signal }),
  },

  /**
   * Email-link auth flows: password reset (request → reset) and email
   * verification (verify-from-link → resend). The request/reset/verify calls are
   * anonymous (no bearer — the emailed token IS the credential) and deliberately
   * non-enumerating server-side: `requestPasswordReset` always 204s regardless of
   * whether the address exists, so the UI shows one neutral success either way.
   * `resendVerification` is the only authenticated call (acts on the current user).
   */
  authEmail: {
    /** Kick off a password reset; always resolves (no account enumeration). */
    requestPasswordReset: (dto: RequestPasswordResetDto) =>
      request<void>('/auth/request-password-reset', {
        method: 'POST',
        json: dto,
        skipAuth: true,
      }),
    /** Complete a password reset using the single-use token from the email. */
    resetPassword: (dto: ResetPasswordDto) =>
      request<void>('/auth/reset-password', { method: 'POST', json: dto, skipAuth: true }),
    /** Confirm an email address from the emailed verification token. */
    verifyEmail: (dto: VerifyEmailDto) =>
      request<void>('/auth/verify-email', { method: 'POST', json: dto, skipAuth: true }),
    /** Re-send the verification email to the signed-in user (requires a session). */
    resendVerification: () => request<void>('/auth/resend-verification', { method: 'POST' }),
  },

  profile: {
    // The backend exposes no GET /profiles/me; derive it from /auth/me → /profiles/:id.
    me: async (): Promise<PublicProfile> => {
      const account = await request<{ id: string }>('/auth/me');
      return request<PublicProfile>(`/profiles/${account.id}`);
    },
    byId: (id: string) => request<PublicProfile>(`/profiles/${id}`),
    update: (dto: UpdateProfileDto) =>
      request<PublicProfile>('/profiles/me', { method: 'PATCH', json: dto }),
    /**
     * Upload a new avatar IMAGE FILE (`multipart/form-data`, field `file`) to
     * `POST /profiles/me/avatar`. The server validates + re-encodes it, deletes
     * the previous file, and returns the updated public profile. `noRetry` is
     * set because the body is a single-use file stream.
     */
    uploadAvatar: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return request<PublicProfile>('/profiles/me/avatar', {
        method: 'POST',
        formData: body,
        noRetry: true,
      });
    },
    /** Reset the avatar to the default (`DELETE /profiles/me/avatar`). */
    removeAvatar: () =>
      request<PublicProfile>('/profiles/me/avatar', { method: 'DELETE' }),
  },

  /**
   * Public-profile discovery. `search` hits `GET /profiles/search` — a free-text
   * nickname-PREFIX query (`q`) with optional `gender`/`country` facets,
   * cursor-paginated (`cursor`/`limit`). The server excludes the caller + anyone
   * they've blocked. Empty/undefined params are dropped by `request`, so calling
   * it with no `q` returns the newest profiles (still gender/country-filtered).
   * Pass a `signal` so a stale, in-flight search is cancelled when the query
   * string changes.
   */
  profiles: {
    search: (
      params: {
        q?: string;
        gender?: Gender;
        country?: CountryCode;
        cursor?: string;
        limit?: number;
      },
      signal?: AbortSignal,
    ) =>
      request<ProfileSearchPage>('/profiles/search', {
        query: {
          q: params.q,
          gender: params.gender,
          country: params.country,
          cursor: params.cursor,
          limit: params.limit,
        },
        signal,
      }),
  },

  /**
   * Friendships. The list of accepted friends + the send/accept/remove
   * mutations live in the `use-friends` feature hooks (they own optimistic
   * cache); this group exposes the read-only pending-requests inbox.
   *
   * `requests` returns BOTH directions in one round-trip
   * (`{ incoming, outgoing }`): incoming = people who asked you (accept via
   * `POST /friends/:id/accept`, decline via `DELETE /friends/:id`); outgoing =
   * requests you sent that are still pending (cancel via `DELETE /friends/:id`).
   * Each item is keyed by `friendshipId` and carries the counterpart's minimal
   * profile, so the page renders avatars + one-tap actions.
   */
  friends: {
    requests: (signal?: AbortSignal) =>
      request<FriendRequestsResponse>('/friends/requests', { signal }),
  },

  economy: {
    wallet: () => request<Wallet>('/economy/wallet'),
    coinPackages: () => request<CoinPackage[]>('/economy/coin-packages'),
    transactions: (cursor?: string, limit?: number) =>
      request<Paginated<CoinTransaction>>('/economy/transactions', { query: { cursor, limit } }),
    gifts: () => request<Gift[]>('/economy/gifts'),
    premiumPlans: () => request<PremiumPlan[]>('/economy/premium-plans'),
    topFeed: () => request<TopPlacement[]>('/economy/top'),
  },

  /**
   * Daily-bonus surface. State is a cheap read; claim is the money-moving call.
   *
   * The wire shape is owned by `DailyBonusState` / `DailyBonusClaimResponse` in
   * `@ruletka/shared-types`, so the FE and the NestJS controller share one
   * contract. The claim is non-idempotent FROM THE CLIENT'S POINT OF VIEW
   * (you only get one credit per UTC day) — but it IS idempotent SERVER-SIDE
   * via the namespaced ledger refId (`daily-bonus:<userId>:<UTC-day>`), so a
   * network retry will quietly land on a 409 from the row's day check instead
   * of double-crediting.
   */
  dailyBonus: {
    state: () => request<DailyBonusState>('/economy/daily-bonus'),
    claim: () =>
      request<DailyBonusClaimResponse>('/economy/daily-bonus/claim', {
        method: 'POST',
        noRetry: true,
      }),
  },

  /**
   * Achievements / badges. Three reads, no mutations — unlocks happen as a
   * SIDE-EFFECT of domain events (purchase, gift sent, call ended, friend
   * accepted, daily-bonus claim) on the API. The catalogue is `skipAuth` so
   * the public profile strip + landing pages can render badge icons before
   * the user signs in.
   */
  achievements: {
    catalogue: (signal?: AbortSignal) =>
      request<AchievementsCatalogue>('/achievements/catalogue', { skipAuth: true, signal }),
    me: (signal?: AbortSignal) => request<MyAchievements>('/achievements/me', { signal }),
    user: (userId: string, signal?: AbortSignal) =>
      request<PublicAchievements>(`/achievements/user/${encodeURIComponent(userId)}`, {
        signal,
      }),
  },

  /**
   * Notifications center + Web Push subscription management.
   *
   * `list` is cursor-paginated history (`GET /notifications`); `unreadCount`
   * powers the header badge; the read actions persist read-state server-side.
   * Push subscribe/unsubscribe register the browser's W3C PushSubscription so
   * the API can fan out delivery beyond the in-app feed.
   */
  notifications: {
    list: (
      params?: { cursor?: string; limit?: number; unreadOnly?: boolean },
      signal?: AbortSignal,
    ) =>
      request<NotificationFeedPage>('/notifications', {
        query: {
          cursor: params?.cursor,
          limit: params?.limit,
          unreadOnly: params?.unreadOnly,
        },
        signal,
      }),
    unreadCount: (signal?: AbortSignal) =>
      request<UnreadCount>('/notifications/unread-count', { signal }),
    markRead: (id: string) => request<void>(`/notifications/${id}/read`, { method: 'POST' }),
    markAllRead: () => request<void>('/notifications/read-all', { method: 'POST' }),
    /** Register a browser Web Push subscription (idempotent server-side). */
    subscribePush: (sub: PushSubscriptionDto) =>
      request<void>('/notifications/push/subscribe', { method: 'POST', json: sub }),
    /** Remove a browser Web Push subscription (DELETE the subscribe route — the
     *  API validates the full W3C subscription DTO and unsubscribes by endpoint). */
    unsubscribePush: (sub: PushSubscriptionDto) =>
      request<void>('/notifications/push/subscribe', { method: 'DELETE', json: sub }),
  },

  /** Community leaderboard — ranked by gifts received, coin balance, or Top days. */
  leaderboard: {
    get: (params: { metric: LeaderboardMetric; limit?: number }, signal?: AbortSignal) =>
      request<LeaderboardResponse>('/leaderboard', {
        query: { metric: params.metric, limit: params.limit },
        signal,
      }),
  },

  /**
   * 3-tier referral program. The `me` + `list` reads + `bind` mutation require
   * a session; `lookup` is the only public call (the register form previews the
   * inviter chip BEFORE the user signs up). The wire shapes are owned by
   * `Referral*` schemas in `@ruletka/shared-types` so a contract drift surfaces
   * at typecheck.
   */
  referrals: {
    /** Read the caller's link + per-tier downline aggregates. */
    me: (signal?: AbortSignal) => request<ReferralMeResponse>('/referrals/me', { signal }),
    /** Cursor-paginated downline list scoped to one tier. */
    list: (
      params: { tier: ReferralTier; cursor?: string; limit?: number },
      signal?: AbortSignal,
    ) =>
      request<ReferralListResponse>('/referrals/me/list', {
        query: { tier: params.tier, cursor: params.cursor, limit: params.limit },
        signal,
      }),
    /**
     * Public preview of a code → inviter nickname. `skipAuth` so the register
     * page can call it with no session at all. Always 200 (`valid: false`
     * carried in the body) so a stale `?ref=` doesn't break the form.
     */
    lookup: (code: string, signal?: AbortSignal) =>
      request<ReferralLookupResponse>(`/referrals/lookup/${encodeURIComponent(code)}`, {
        skipAuth: true,
        signal,
      }),
    /**
     * Attach the authenticated user to an inviter by code. Sent right after a
     * successful registration when the form carried a `?ref=` query.
     */
    bind: (dto: ReferralBindDto) =>
      request<void>('/referrals/bind', { method: 'POST', json: dto, noRetry: true }),
  },

  /**
   * KYC age-verification surface.
   *
   * `me` is a cheap read the settings tile polls; `start` opens a provider
   * session and returns the redirectUrl the UI opens in a NEW TAB (the
   * provider iframe lives off our origin). Webhooks lands back into the API
   * out-of-band — the UI just refetches `me` to surface the new status.
   *
   * The matchmaking gate that consults this surface is opt-in via the
   * `KYC_REQUIRED` env on the API; with the gate OFF (default), the tile is
   * informational only and `start` is the user's voluntary path to a
   * verified badge.
   */
  kyc: {
    me: (signal?: AbortSignal) => request<KycMeResponse>('/kyc/me', { signal }),
    start: () =>
      request<KycStartResponse>('/kyc/start', { method: 'POST', noRetry: true }),
  },
} as const;

/**
 * Cursor-paginated notifications history envelope (`GET /notifications`).
 * Mirrors the list shape used elsewhere: a page of stored records plus the next
 * cursor (`null` when exhausted).
 */
export interface NotificationFeedPage {
  items: StoredNotificationRecord[];
  nextCursor: string | null;
}

export type Api = typeof api;
