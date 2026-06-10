'use client';

/**
 * Daily-bonus react-query bindings used by the dashboard widget.
 *
 * `useDailyBonus()` reads the live state via `GET /economy/daily-bonus`.
 * `useClaimDailyBonus()` runs the claim mutation and, on success, invalidates
 * both the daily-bonus cache (so the widget re-renders the new streak / next
 * reset time) AND the shared wallet/balance key (so the header coin pill
 * updates immediately, without waiting for the wallet's own refetch interval).
 *
 * BOTH read AND mutation are gated on the auth session — `/economy/daily-bonus`
 * is authenticated, so firing it pre-auth would 401-storm the API. The mutation
 * gate avoids hitting an unauthenticated 401 mid-page if the session lapses.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DailyBonusClaimResponse, DailyBonusState } from '@ruletka/shared-types';

import { api } from '@/lib/api';
import { useAuth } from '@/features/auth';
import { economyKeys } from '@/features/economy/api';

/** Centralised TanStack Query keys for the daily-bonus cache. */
export const dailyBonusKeys = {
  all: ['daily-bonus'] as const,
  state: () => [...dailyBonusKeys.all, 'state'] as const,
} as const;

/**
 * Live daily-bonus state for the signed-in caller. The query is `enabled` only
 * once the auth bootstrap has resolved to an authenticated session, mirroring
 * the wallet hook so anonymous routes (landing / login) don't fire a
 * guaranteed-401.
 */
export function useDailyBonus() {
  const { isAuthenticated } = useAuth();
  return useQuery<DailyBonusState>({
    queryKey: dailyBonusKeys.state(),
    queryFn: api.dailyBonus.state,
    enabled: isAuthenticated,
    // The state is cheap and the UI peek (next-reset countdown, streak chip)
    // benefits from staying fresh as the user idles on the dashboard.
    staleTime: 30_000,
  });
}

/**
 * Claim mutation. On success seeds the cache with the post-claim state so the
 * widget animates immediately without a round-trip, then invalidates the
 * wallet/balance key so the header coin pill reflects the newly-credited
 * coins as soon as the cache lets it through.
 *
 * The caller (the widget) handles the toast / "+N" float-up animation in its
 * own onSuccess so the mutation hook stays UI-agnostic.
 */
export function useClaimDailyBonus() {
  const qc = useQueryClient();
  return useMutation<DailyBonusClaimResponse>({
    mutationFn: api.dailyBonus.claim,
    onSuccess: (res) => {
      // Seed the state so the widget can render the new streak immediately
      // without waiting for the follow-up refetch — and the rung animation
      // starts from the just-credited rung rather than the previous one.
      qc.setQueryData<DailyBonusState>(dailyBonusKeys.state(), {
        streak: res.streak,
        claimedToday: res.claimedToday,
        canClaim: res.canClaim,
        nextRewardCoins: res.nextRewardCoins,
        ladder: res.ladder,
        nextResetAt: res.nextResetAt,
        lifetimeCoins: res.lifetimeCoins,
      });
      // Cross-feature invalidations: the wallet hook's `economyKeys.wallet()`
      // is the canonical balance key the header pill / wallet page subscribe
      // to. Transactions also moved (a new `bonus` ledger row landed).
      void qc.invalidateQueries({ queryKey: dailyBonusKeys.state() });
      void qc.invalidateQueries({ queryKey: economyKeys.wallet() });
      void qc.invalidateQueries({ queryKey: economyKeys.transactions() });
    },
  });
}
