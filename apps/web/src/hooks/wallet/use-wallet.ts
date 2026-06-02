'use client';

/**
 * Wallet hooks — the single source of truth for the caller's coin balance and
 * ledger across the economy features (and, once wired, the header pill).
 *
 * All hooks wrap the EXISTING base `api` client via the feature-local
 * `economyApi`, and use the shared TanStack Query cache so a successful
 * purchase / gift / top-buy can invalidate the balance everywhere at once.
 */
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { CoinTransaction, Wallet } from '@ruletka/shared-types';

import { economyApi, economyKeys, type CoinTransactionPage } from '@/features/economy/api';
import { useAuth } from '@/features/auth';

/**
 * Live wallet balance. Returns the full query so callers can render loading /
 * error states. `data?.balanceCoins` is the coin count.
 *
 * Guarded by the session: `/wallet` is an authenticated endpoint, so the query
 * only runs once the viewer is signed in. This keeps anonymous surfaces (e.g.
 * the header pill on the marketing landing) from firing a guaranteed-401
 * request. Authenticated pages mount under `RequireAuth`, so the gate is a
 * no-op for them.
 */
export function useWallet(): UseQueryResult<Wallet> {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: economyKeys.wallet(),
    queryFn: economyApi.wallet,
    enabled: isAuthenticated,
  });
}

/** Convenience: just the numeric balance (or `null` until known). */
export function useCoinBalance(): number | null {
  const { data } = useWallet();
  return data?.balanceCoins ?? null;
}

/**
 * Cursor-paginated coin ledger (newest first). Flatten `data.pages` to a single
 * list of {@link CoinTransaction}s for rendering.
 */
export function useTransactions(limit = 20) {
  return useInfiniteQuery({
    queryKey: economyKeys.transactions(),
    queryFn: ({ pageParam }) => economyApi.transactions(pageParam, limit),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: CoinTransactionPage) => lastPage.nextCursor ?? undefined,
  });
}

/** Flattens an infinite-ledger query result into a single transaction array. */
export function flattenTransactions(
  pages: CoinTransactionPage[] | undefined,
): CoinTransaction[] {
  if (!pages) return [];
  return pages.flatMap((p) => p.items);
}

/**
 * Returns helpers to refresh economy caches after a money-moving action.
 * `refetchBalance` is the typical post-checkout call (the real credit arrives
 * via the CloudPayments webhook, so we poll the balance briefly).
 */
export function useEconomyInvalidation() {
  const qc = useQueryClient();

  const invalidateBalance = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: economyKeys.wallet() }),
      qc.invalidateQueries({ queryKey: economyKeys.transactions() }),
    ]);

  /**
   * Poll the balance a few times after a pending purchase so the UI reflects
   * the webhook-driven credit without a manual refresh. Stops early once the
   * balance increases beyond `fromBalance`.
   */
  const pollBalance = async (fromBalance: number | null, attempts = 6, intervalMs = 2500) => {
    for (let i = 0; i < attempts; i += 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
      const next = await qc.fetchQuery({
        queryKey: economyKeys.wallet(),
        queryFn: economyApi.wallet,
      });
      qc.invalidateQueries({ queryKey: economyKeys.transactions() });
      if (fromBalance === null || next.balanceCoins > fromBalance) break;
    }
  };

  return { invalidateBalance, pollBalance };
}
