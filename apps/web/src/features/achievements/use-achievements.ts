'use client';

/**
 * React-query bindings for the achievements module.
 *
 * Three queries:
 *  - `useAchievementsCatalogue()` reads the static catalogue (public, 24h
 *    staleTime — server cache-controls it for an hour anyway).
 *  - `useMyAchievements()`        reads the authenticated user's unlocks +
 *    progress + the server-stamped `checkedAt` cursor. Gated on auth so
 *    anonymous pages don't 401-storm.
 *  - `usePublicAchievements(id)`  reads someone else's public unlock list
 *    for the profile strip; server-side `whoCanViewProfile` gate may 404.
 *
 * On a /me refetch we DETECT newly-unlocked badges by comparing each row's
 * `unlockedAt` against the previously-seen `checkedAt` and fire a toast for
 * the new ones. The toast handler is registered as a `onSuccess` callback so
 * the hook stays declarative — the page that wants the toast hands it in.
 */
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type {
  AchievementsCatalogue,
  MyAchievements,
  PublicAchievements,
  UserAchievementUnlock,
} from '@ruletka/shared-types';

import { api } from '@/lib/api';
import { useAuth } from '@/features/auth';

/** Centralised TanStack Query keys. */
export const achievementsKeys = {
  all: ['achievements'] as const,
  catalogue: () => [...achievementsKeys.all, 'catalogue'] as const,
  me: () => [...achievementsKeys.all, 'me'] as const,
  user: (userId: string) => [...achievementsKeys.all, 'user', userId] as const,
} as const;

/**
 * Static catalogue. Cached for 24h on the client — the server cache-controls
 * the route at `s-maxage=3600`, so the CDN cache + the in-memory store keep
 * this off the network on every navigation.
 */
export function useAchievementsCatalogue(
  options?: Pick<UseQueryOptions<AchievementsCatalogue>, 'enabled'>,
) {
  return useQuery<AchievementsCatalogue>({
    queryKey: achievementsKeys.catalogue(),
    queryFn: () => api.achievements.catalogue(),
    staleTime: 24 * 60 * 60 * 1000,
    ...options,
  });
}

/**
 * Authenticated `GET /achievements/me`. The 60s staleTime keeps the grid
 * snappy on tab switches without hammering the API; an explicit invalidation
 * after an action that COULD unlock something (purchase, gift sent, friend
 * accepted) belongs at the call site.
 */
export function useMyAchievements() {
  const { isAuthenticated } = useAuth();
  return useQuery<MyAchievements>({
    queryKey: achievementsKeys.me(),
    queryFn: () => api.achievements.me(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });
}

/**
 * Public-profile unlock list. The server may 404 if the target's
 * `whoCanViewProfile` blocks the viewer — react-query surfaces that as an
 * error and the strip just hides gracefully (the public-profile-client
 * already handles the 404 for the profile read itself).
 */
export function usePublicAchievements(userId: string) {
  return useQuery<PublicAchievements>({
    queryKey: achievementsKeys.user(userId),
    queryFn: () => api.achievements.user(userId),
    staleTime: 60_000,
    // The whole strip is hidden when the request errors — see strip.tsx.
    retry: false,
  });
}

/**
 * Stable detection of NEWLY-unlocked badges since the last visit.
 *
 * Compares each row's `unlockedAt` against the previously-seen `checkedAt`
 * cursor stored in `localStorage` (per-user — multi-account safe). Returns the
 * new rows and ADVANCES the cursor in the same tick, so a subsequent re-render
 * doesn't fire the toast again. The cursor is per-user so a sign-out → sign-in
 * doesn't replay another account's history. SSR-safe — the read+write is
 * guarded against a missing `window`.
 */
export function useNewlyUnlocked(
  data: MyAchievements | undefined,
  onNewUnlock: (unlock: UserAchievementUnlock) => void,
): void {
  const { user } = useAuth();
  // Guard the effect against firing twice for the same checkedAt (StrictMode).
  const firedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!data || !user?.id) return;
    if (firedFor.current === data.checkedAt) return;
    firedFor.current = data.checkedAt;

    const storageKey = `ruletka:achievements:lastSeen:${user.id}`;
    let previousIso: string | null = null;
    try {
      previousIso = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null;
    } catch {
      previousIso = null;
    }

    // First visit — never replay history. Just stamp and move on.
    if (!previousIso) {
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(storageKey, data.checkedAt);
        }
      } catch {
        // localStorage disabled / quota exceeded — soft-fail; the toast just
        // won't fire on this visit.
      }
      return;
    }

    const previousMs = Date.parse(previousIso);
    const newlyUnlocked = data.unlocked.filter((u) => Date.parse(u.unlockedAt) > previousMs);
    for (const unlock of newlyUnlocked) {
      onNewUnlock(unlock);
    }

    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, data.checkedAt);
      }
    } catch {
      // soft-fail; see above
    }
  }, [data, user?.id, onNewUnlock]);
}

/**
 * Force a re-fetch of the /me query — call this after any action that COULD
 * have unlocked a badge (purchase widget closed, gift sent, friend accepted,
 * daily-bonus claim).
 *
 * Cheap by design — the server already snapshots all counters in one batched
 * read on the route, so an opportunistic invalidate is fine on the success
 * paths.
 */
export function useInvalidateAchievements(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: achievementsKeys.me() });
  };
}
