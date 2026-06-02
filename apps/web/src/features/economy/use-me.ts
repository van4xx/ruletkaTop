'use client';

/**
 * Self-contained "current user" query for the economy features.
 *
 * Wraps the EXISTING base `api.profile.me()` so gifts/premium can gate on
 * `isPremium` and prefill the payer account without coupling to the auth
 * feature's (separately-owned) hooks. Returns `null` (not an error) when the
 * viewer is unauthenticated so pages can degrade gracefully.
 */
import { useQuery } from '@tanstack/react-query';
import type { PublicProfile } from '@ruletka/shared-types';
import { api, ApiClientError } from '@/lib/api';

export const meKey = ['economy', 'me'] as const;

export function useMe() {
  return useQuery<PublicProfile | null>({
    queryKey: meKey,
    queryFn: async () => {
      try {
        return await api.profile.me();
      } catch (err) {
        // Unauthenticated → treat as "no viewer" rather than a hard error.
        if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
          return null;
        }
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

/** Convenience boolean: is the current viewer a premium member? */
export function useIsPremium(): boolean {
  const { data } = useMe();
  return data?.isPremium ?? false;
}
