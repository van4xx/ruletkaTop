'use client';

/**
 * Top-feed feature hooks: the two-lane feed, per-placement profile lookups, and
 * the "buy a spot" purchase (debits coins server-side, validated against the
 * shared `topPurchaseSchema`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicProfile, TopPurchaseDto } from '@ruletka/shared-types';

import { api, ApiClientError } from '@/lib/api';
import { economyApi, economyKeys } from '@/features/economy/api';
import { useEconomyInvalidation } from '@/hooks/wallet/use-wallet';

/** The two active lanes (priority desc within each). */
export function useTopFeed() {
  return useQuery({
    queryKey: economyKeys.topFeed(),
    queryFn: economyApi.topFeed,
    // The feed is paid + time-boxed; keep it fresh-ish.
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

/**
 * Resolve a single placement's public profile for its card. Cached + deduped by
 * id, so the same user appearing twice costs one request. Returns `null` (not
 * an error) when the profile can't be loaded so the card shows a graceful
 * fallback identicon.
 */
export function useTopProfile(userId: string) {
  return useQuery<PublicProfile | null>({
    queryKey: economyKeys.profile(userId),
    queryFn: async () => {
      try {
        return await api.profile.byId(userId);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 404) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });
}

/** Buy a Top placement; invalidates the feed + wallet on success. */
export function usePurchaseTop() {
  const qc = useQueryClient();
  const { invalidateBalance } = useEconomyInvalidation();
  return useMutation({
    mutationFn: (dto: TopPurchaseDto) => economyApi.purchaseTop(dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: economyKeys.topFeed() });
      void invalidateBalance();
    },
  });
}
