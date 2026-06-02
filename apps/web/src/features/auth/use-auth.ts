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
import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { AuthUser } from '@ruletka/shared-types';
import { api, ApiClientError, getAccessToken } from '@/lib/api';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import { useAuthStore, hasPresenceHint } from '@/lib/stores/auth-store';

/** Query key for the authenticated user. */
export const CURRENT_USER_KEY = ['auth', 'me'] as const;

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
 * exists, keeps the zustand store in sync, and clears auth on a hard 401.
 */
export function useCurrentUser(): UseQueryResult<AuthUser, ApiClientError> {
  const setUser = useAuthStore((s) => s.setUser);
  const setReady = useAuthStore((s) => s.setReady);

  const query = useQuery<AuthUser, ApiClientError>({
    queryKey: CURRENT_USER_KEY,
    queryFn: fetchCurrentUser,
    enabled: hasPresenceHint(),
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
 * If no session is persisted we immediately mark the store ready; otherwise we
 * let {@link useCurrentUser} revalidate and connect the socket with the live
 * access token. The socket is disconnected on sign-out.
 */
export function useAuthBootstrap(): void {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setReady = useAuthStore((s) => s.setReady);

  // Drive the /auth/me revalidation.
  useCurrentUser();

  useEffect(() => {
    if (!hasPresenceHint()) {
      setReady(true);
    }
  }, [setReady]);

  // Keep the realtime socket bound to the current session.
  useEffect(() => {
    if (isAuthenticated) {
      // The api client's TokenStore is the single source of truth for the
      // access token (localStorage-backed + rehydrated on load); read it back
      // through the client so no storage-key knowledge leaks here.
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
