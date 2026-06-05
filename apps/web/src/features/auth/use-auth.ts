'use client';

/**
 * Auth hooks: the public surface every other feature consumes.
 *
 * - {@link useAuth}        — synchronous snapshot of the auth store
 *   (`user`, `isAuthenticated`, `isPremium`, `isReady`) + `logout`.
 * - {@link useCurrentUser} — a TanStack Query that revalidates the session
 *   against `/auth/me`; the single network source of truth for "who am I".
 * - {@link useAuthBootstrap} — run once near the root: hydrates the store from
 *   a persisted session and connects the realtime socket.
 *
 * All network access goes through the existing typed api client; we only add
 * thin feature-local wrappers (no changes to shared `lib/api`/`lib/socket`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { AuthUser } from '@ruletka/shared-types';
import {
  api,
  ApiClientError,
  bindRefreshOnResume,
  getAccessToken,
  refreshAccessToken,
} from '@/lib/api';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import { useAuthStore, hasPresenceHint } from '@/lib/stores/auth-store';

/** Query key for the authenticated user. */
export const CURRENT_USER_KEY = ['auth', 'me'] as const;

// ───────────────────────── Boot refresh tuning ────────────────────────
/**
 * Boot rehydration calls `/auth/refresh` FIRST so the in-memory access token is
 * in hand before `/auth/me` runs (the token is in-memory-only, so a reload drops
 * it). A transient failure (offline / cold API / 5xx) is retried with backoff
 * rather than dropping the user to signed-out — a still-valid 30-day refresh
 * cookie should survive a network blip. Only a HARD 401 means the session is
 * truly gone (the api client emits the expiry toast + we clear here).
 */
const BOOT_REFRESH_MAX_ATTEMPTS = 4;
const BOOT_REFRESH_BASE_MS = 400;
const BOOT_REFRESH_MAX_MS = 4_000;

/**
 * Fetch the authenticated user. NOTE: the backend's `/auth/me` returns an
 * `AuthUser` (not the `PublicProfile` the base api client's type hints suggest),
 * so we type the low-level request explicitly here.
 */
async function fetchCurrentUser(): Promise<AuthUser> {
  return api.request<AuthUser>('/auth/me');
}

/**
 * The canonical "current user" query. Only runs when a persisted session
 * exists AND boot has acquired an access token, keeps the zustand store in
 * sync, and (via the api client) clears auth on a hard 401.
 *
 * `enabled` lets the boot sequence hold this back until `/auth/refresh` has put
 * a fresh access token in memory, so `/auth/me` never races the cold-start
 * refresh and never settles the user as signed-out on a transient blip.
 */
export function useCurrentUser(enabled = true): UseQueryResult<AuthUser, ApiClientError> {
  const setUser = useAuthStore((s) => s.setUser);
  const setReady = useAuthStore((s) => s.setReady);

  const query = useQuery<AuthUser, ApiClientError>({
    queryKey: CURRENT_USER_KEY,
    queryFn: fetchCurrentUser,
    enabled: enabled && hasPresenceHint(),
    staleTime: 60_000,
    retry: false,
  });

  // Mirror query results into the global store.
  useEffect(() => {
    if (query.data) {
      setUser(query.data);
      setReady(true);
    }
  }, [query.data, setUser, setReady]);

  useEffect(() => {
    if (query.isError) {
      // A transient /auth/me failure must NOT nuke the session: the api client
      // already attempts a cookie-based refresh + retry, and the httpOnly refresh
      // cookie outlives the in-memory access token across reloads/navigations.
      // Aggressively clearing here caused a login→dashboard bounce loop. Only an
      // explicit logout clears auth; here we just settle the boot state.
      setReady(true);
    }
  }, [query.isError, setReady]);

  return query;
}

/**
 * Boot sequence — mount once high in the tree (e.g. an AuthProvider/guard).
 *
 * Resilient rehydration:
 *  - No presence hint → no session was ever persisted → mark ready immediately.
 *  - Presence hint → the access token is in-memory-only and was dropped by the
 *    reload, so acquire one via `/auth/refresh` FIRST (single-flight, with a
 *    bounded retry on transient network/5xx failures) BEFORE enabling `/auth/me`.
 *    This stops the `/auth/me` boot call from racing the cold-start refresh and
 *    settling the user as signed-out on a mere network blip.
 *  - A HARD 401 from refresh is the only real "session is gone" signal: the api
 *    client clears the token + emits the expiry toast; we clear the store here.
 *  - A persistently transient refresh (offline for the whole backoff budget)
 *    still releases the boot gate so the app isn't stuck on a spinner forever —
 *    `/auth/me`'s own transparent refresh + the resume listeners remain as
 *    backstops, and the session is NOT cleared.
 *
 * The socket is (re)bound to the live token whenever auth state flips.
 */
export function useAuthBootstrap(): void {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setReady = useAuthStore((s) => s.setReady);
  const clear = useAuthStore((s) => s.clear);

  // Gate for `/auth/me`: stays false until boot has a token in hand (or there's
  // no session to restore, in which case the query is disabled by the presence
  // hint anyway).
  const [bootRefreshSettled, setBootRefreshSettled] = useState(false);
  const bootStarted = useRef(false);

  // One-time resume listeners (refresh on tab focus / network back) so a tab
  // suspended past its proactive-refresh wakes authenticated, not 401-ing.
  useEffect(() => {
    bindRefreshOnResume();
  }, []);

  // Refresh-first boot.
  useEffect(() => {
    if (bootStarted.current) return;
    bootStarted.current = true;

    // No persisted session → nothing to rehydrate; we're ready.
    if (!hasPresenceHint()) {
      setReady(true);
      setBootRefreshSettled(true);
      return;
    }

    let cancelled = false;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });

    void (async () => {
      for (let attempt = 0; attempt < BOOT_REFRESH_MAX_ATTEMPTS; attempt += 1) {
        const result = await refreshAccessToken();
        if (cancelled) return;

        if (result.ok) {
          // Token in memory → let `/auth/me` confirm the user.
          setBootRefreshSettled(true);
          return;
        }
        if (result.reason === 'unauthorized') {
          // Hard rejection: the refresh cookie is gone/expired/revoked. The api
          // client already emitted the expiry signal; tear the session down.
          clear();
          setBootRefreshSettled(true);
          return;
        }
        // Transient (offline / 5xx): back off and retry. Keep the session.
        const backoff = Math.min(BOOT_REFRESH_MAX_MS, BOOT_REFRESH_BASE_MS * 2 ** attempt);
        await sleep(backoff * (0.5 + Math.random() * 0.5));
        if (cancelled) return;
      }
      // Exhausted the retry budget while still transient: don't trap the user on
      // a spinner. Release the gate WITHOUT clearing — a still-valid cookie can
      // recover via `/auth/me`'s transparent refresh or the resume listeners.
      if (!cancelled) setBootRefreshSettled(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [setReady, clear]);

  // Drive the /auth/me revalidation once boot has a token (or there's no
  // session, where the presence-hint guard keeps it disabled anyway).
  useCurrentUser(bootRefreshSettled);

  // Keep the realtime socket bound to the current session.
  useEffect(() => {
    if (isAuthenticated) {
      // The api client's TokenStore is the single source of truth for the
      // access token; read it back through the client so no storage-key
      // knowledge leaks here.
      const token = getAccessToken();
      if (token) connectSocket(token);
    } else {
      disconnectSocket();
    }
  }, [isAuthenticated]);
}

export interface UseAuthResult {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isPremium: boolean;
  /** True once the initial hydration/revalidation has settled. */
  isReady: boolean;
  /** Revoke the session locally (+ best-effort server logout) and disconnect. */
  logout: () => Promise<void>;
}

/**
 * Synchronous access to auth state plus a `logout` action. Safe to call in any
 * client component; reads are reactive via the zustand store.
 */
export function useAuth(): UseAuthResult {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isPremium = useAuthStore((s) => s.isPremium);
  const isReady = useAuthStore((s) => s.isReady);
  const clear = useAuthStore((s) => s.clear);
  const queryClient = useQueryClient();

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      /* even if the server call fails, clear locally */
    } finally {
      clear();
      disconnectSocket();
      queryClient.removeQueries({ queryKey: CURRENT_USER_KEY });
    }
  }, [clear, queryClient]);

  return { user, isAuthenticated, isPremium, isReady, logout };
}
