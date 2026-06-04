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
import { getAccessToken } from '@/lib/api';

export interface SessionInfo {
  /** Raw access token for the socket handshake, or null when signed out. */
  token: string | null;
  /** True once the auth store has finished its boot revalidation. */
  ready: boolean;
  /** Whether the current user has premium (drives premium-gated filters). */
  isPremium: boolean;
}

/**
 * Resolves the current session for realtime features (roulette).
 *
 * The access token lives ONLY in memory (the api client's token store — never
 * localStorage), and the canonical auth state lives in the zustand store. So we
 * read the raw token from {@link getAccessToken} and gate readiness on the
 * store's `isReady` (true once the cold-start cookie refresh has resolved). We
 * re-read the in-memory token whenever auth state flips (boot refresh completes,
 * login, logout) so the roulette gate and socket handshake see a live token —
 * NOT the perpetually-empty localStorage that broke /video + /voice before.
 */
export function useAuthToken(): SessionInfo {
  const isPremium = useAuthStore((s) => s.isPremium);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isReady = useAuthStore((s) => s.isReady);

  const [token, setToken] = useState<string | null>(null);

  // Re-read the in-memory access token whenever readiness/auth flips. After the
  // boot revalidation populates the token + sets isAuthenticated, this picks it
  // up; on logout it clears.
  useEffect(() => {
    setToken(getAccessToken());
  }, [isAuthenticated, isReady]);

  return { token, ready: isReady, isPremium };
}
