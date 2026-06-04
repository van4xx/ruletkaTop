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
  ApiError,
  AuthResponse,
  AuthTokens,
  CoinPackage,
  CoinTransaction,
  CountryCode,
  FriendRequestsResponse,
  Gender,
  Gift,
  LeaderboardMetric,
  LeaderboardResponse,
  LoginDto,
  Notification as StoredNotificationRecord,
  PaginationMeta,
  PremiumPlan,
  PublicProfile,
  PushSubscriptionDto,
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

/** In-flight refresh promise, so concurrent 401s share one refresh round-trip. */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Exchange the httpOnly refresh COOKIE for a fresh access token.
 *
 * Sends no body and no bearer — the refresh token rides along as a cookie
 * (`credentials: 'include'`), and the API rotates that cookie in its response.
 * The new access token (response body) is stored in memory. Returns `true` on
 * success. Concurrent callers share a single in-flight round-trip.
 */
async function tryRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(buildUrl('/auth/refresh'), {
          method: 'POST',
          // Send the httpOnly refresh cookie; receive a rotated one.
          credentials: 'include',
        });
        if (!res.ok) {
          setAuthTokens(null);
          return false;
        }
        // The API returns an AuthResponse ({ user, tokens }); the refresh token
        // stays in the rotated httpOnly cookie, so only tokens.accessToken matters.
        const body = (await res.json()) as { tokens?: AuthTokens };
        const tokens = body.tokens;
        if (!tokens?.accessToken) {
          setAuthTokens(null);
          return false;
        }
        setAuthTokens(tokens);
        return true;
      } catch {
        setAuthTokens(null);
        return false;
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
 * restore — only the httpOnly cookie). Returns `true` if a session was
 * re-established.
 */
export function refreshAccessToken(): Promise<boolean> {
  return tryRefresh();
}

/**
 * A SINGLE network attempt: builds headers, sends the request, and performs at
 * most one transparent cookie-refresh + retry on a 401. This is the unit the
 * backoff layer re-invokes; it deliberately contains no retry loop of its own
 * (other than the one-shot 401 refresh, which is an auth concern, not a
 * transient-failure concern).
 */
async function performRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const { json, query, skipAuth, _isRetry, signal, headers, ...init } = options;

  const finalHeaders = new Headers(headers);
  if (json !== undefined && !finalHeaders.has('content-type')) {
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
      body: json !== undefined ? JSON.stringify(json) : undefined,
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
  if (res.status === 401 && !skipAuth && !_isRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) {
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
