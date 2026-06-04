'use client';

/**
 * Global authentication store (zustand) + the token persistence strategy for
 * the whole web app.
 *
 * ─────────────────────────── Token strategy ───────────────────────────────
 * Hardened cookie strategy:
 *   - The REFRESH token lives ONLY in an httpOnly, SameSite=Strict cookie set
 *     by the API and scoped to `/api/auth`. JavaScript can't read it, so an XSS
 *     payload can't exfiltrate it.
 *   - The short-lived ACCESS token is held IN MEMORY only (the api client's
 *     token store) — never localStorage. A reload drops it; the app re-acquires
 *     one by calling `/auth/refresh` (the cookie is sent automatically) during
 *     boot.
 *   - We still mirror a lightweight, NON-httpOnly **presence flag** cookie
 *     (`ruletka_auth=1`) so Next.js edge middleware — which can only read
 *     cookies — can gate protected routes. Its value is an OPAQUE marker, never
 *     the token; the real authority for every request stays the bearer access
 *     token + server validation.
 *
 * The store is the single source of truth for `user`, `isAuthenticated` and
 * `isPremium`. It owns the presence-cookie writes; access-token reads/writes
 * funnel through the api client's in-memory store via `setAuthTokens`.
 */
import { create } from 'zustand';
import type { AuthTokens, AuthUser } from '@ruletka/shared-types';
import { setAuthTokens } from '@/lib/api';

/** Non-httpOnly PRESENCE marker cookie read by `src/middleware.ts`. */
export const AUTH_COOKIE = 'ruletka_auth';
/** Opaque value stored in the presence cookie — NOT a token. */
const PRESENCE_FLAG = '1';
/** 30 days, in seconds — matches the refresh window so the hint outlives reloads. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

const isBrowser = typeof window !== 'undefined';

// ───────────────────────────── Cookie helpers ─────────────────────────────
/**
 * On prod (`https://*.ruletka.top`) the web app lives on the apex (`ruletka.top`)
 * while the API lives on `api.ruletka.top`. The API sets the presence + refresh
 * cookies with `Domain=.ruletka.top` so they're shared across both. The
 * CLIENT-written presence marker must use the SAME parent domain, otherwise we'd
 * end up with two competing cookies (one host-only, one parent-domain) and the
 * edge middleware could read a stale host-only copy after a server-side clear.
 *
 * Returns the `; Domain=…` attribute to append, or '' on localhost / a non-https
 * host / any host not under `ruletka.top` (where a parent domain is wrong or
 * impossible — the cookie stays host-only, matching the dev API).
 */
function presenceCookieDomainAttr(): string {
  if (!isBrowser) return '';
  const { protocol, hostname } = window.location;
  if (protocol !== 'https:') return '';
  if (hostname === 'ruletka.top' || hostname.endsWith('.ruletka.top')) {
    return '; Domain=.ruletka.top';
  }
  return '';
}

function writePresenceCookie(): void {
  if (!isBrowser) return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  const domain = presenceCookieDomainAttr();
  document.cookie = `${AUTH_COOKIE}=${PRESENCE_FLAG}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax${domain}${secure}`;
}

function clearPresenceCookie(): void {
  if (!isBrowser) return;
  // Echo the same Domain so the parent-domain cookie is actually removed (a
  // host-only clear would leave a `.ruletka.top` cookie lingering).
  const domain = presenceCookieDomainAttr();
  document.cookie = `${AUTH_COOKIE}=; path=/; max-age=0; SameSite=Lax${domain}`;
}

/** Does the edge-readable presence hint exist? (Used by the boot sequence.) */
export function hasPresenceHint(): boolean {
  if (!isBrowser) return false;
  return document.cookie
    .split('; ')
    .some((entry) => entry.startsWith(`${AUTH_COOKIE}=`) && entry !== `${AUTH_COOKIE}=`);
}

// ──────────────────────────────── Store ───────────────────────────────────
interface AuthState {
  /** The authenticated user, or `null` when signed out / not yet known. */
  user: AuthUser | null;
  /** True once a user is present. */
  isAuthenticated: boolean;
  /** Convenience mirror of `user.isPremium`. */
  isPremium: boolean;
  /** Whether the initial boot/hydration check has completed. */
  isReady: boolean;

  /** Persist a fresh session (in-memory access token + user) after login/register. */
  setSession: (payload: { user: AuthUser; tokens: AuthTokens }) => void;
  /** Update just the user (e.g. after `/auth/me` revalidation). */
  setUser: (user: AuthUser | null) => void;
  /** Mark boot/hydration as finished. */
  setReady: (ready: boolean) => void;
  /** Clear all auth state + the in-memory token + the presence cookie. */
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isPremium: false,
  isReady: false,

  setSession: ({ user, tokens }) => {
    // Store the access token in memory only; refresh stays in the httpOnly
    // cookie the API already set on the response. `setAuthTokens` also ARMS the
    // proactive silent-refresh timer (scheduled ~60s before the token's `exp`),
    // so a logged-in session keeps a valid access token in memory continuously
    // instead of 401-then-refreshing on the first click after an idle period.
    setAuthTokens(tokens);
    writePresenceCookie();
    set({ user, isAuthenticated: true, isPremium: user.isPremium, isReady: true });
  },

  setUser: (user) => {
    if (user) writePresenceCookie();
    set({
      user,
      isAuthenticated: Boolean(user),
      isPremium: user?.isPremium ?? false,
    });
  },

  setReady: (ready) => set({ isReady: ready }),

  clear: () => {
    // `setAuthTokens(null)` drops the in-memory access token AND STOPS the
    // proactive-refresh timer, so a signed-out session never keeps refreshing.
    setAuthTokens(null);
    clearPresenceCookie();
    set({ user: null, isAuthenticated: false, isPremium: false, isReady: true });
  },
}));
