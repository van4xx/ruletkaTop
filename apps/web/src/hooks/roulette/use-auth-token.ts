'use client';

/**
 * Resolves the current session for realtime features.
 *
 * The auth feature owns the canonical store at `@/lib/stores/auth-store`
 * (zustand): it wires the api client's {@link TokenStore}, persists tokens to
 * `localStorage['ruletka.accessToken']` + a marker cookie, and exposes
 * `isAuthenticated` / `isPremium` / `isReady`. We consume that store reactively
 * for gating decisions, and read the raw access token from the same
 * `localStorage` key for the socket handshake (the token itself isn't held in
 * store state).
 *
 * Keeping the localStorage read here means /video and /voice still work in dev
 * even if the boot revalidation hasn't populated `user` yet — without creating
 * a hard import cycle on the auth feature's UI.
 */
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/stores/auth-store';

/** LocalStorage key the auth store mirrors the access token to. */
export const ACCESS_TOKEN_STORAGE_KEY = 'ruletka.accessToken';

function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export interface SessionInfo {
  /** Raw access token for the socket handshake, or null when signed out. */
  token: string | null;
  /** True once we've attempted to read the token on the client. */
  ready: boolean;
  /** Whether the current user has premium (drives premium-gated filters). */
  isPremium: boolean;
}

export function useAuthToken(): SessionInfo {
  const isPremium = useAuthStore((s) => s.isPremium);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setToken(readToken());
    setReady(true);

    function onStorage(event: StorageEvent) {
      if (event.key === ACCESS_TOKEN_STORAGE_KEY) setToken(event.newValue);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Re-read when auth state flips in this tab (login/logout don't fire
  // `storage` for the originating tab).
  useEffect(() => {
    setToken(readToken());
  }, [isAuthenticated]);

  return { token, ready, isPremium };
}
