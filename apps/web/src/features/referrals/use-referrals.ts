'use client';

/**
 * Referral program hooks — typed React Query wrappers around the `referrals.*`
 * client namespace in `@/lib/api`.
 *
 * Three reads (`me`, `list`, `lookup`) and one mutation (`bind`). All reads are
 * gated by an `enabled` flag at the call site so a signed-out visitor on the
 * referrals page or the register form's invite chip doesn't fire requests.
 *
 * The `me` query is cached for 30s — link + aggregates change at the cadence
 * of the BullMQ reward sweep (every 60s), so a sub-minute stale window keeps
 * the dashboard fresh enough.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type {
  ReferralBindDto,
  ReferralListResponse,
  ReferralLookupResponse,
  ReferralMeResponse,
  ReferralTier,
} from '@ruletka/shared-types';

import { api } from '@/lib/api';

/**
 * Stable query-key factory. Mirrors the convention used elsewhere
 * (`friendsKeys`, `walletKeys`, …) so the invalidations after `bind` are tidy.
 */
export const referralsKeys = {
  all: ['referrals'] as const,
  me: () => [...referralsKeys.all, 'me'] as const,
  list: (tier: ReferralTier) => [...referralsKeys.all, 'list', tier] as const,
  lookup: (code: string) => [...referralsKeys.all, 'lookup', code] as const,
};

/** Read the caller's link + per-tier aggregates. */
export function useReferralMe(options?: {
  enabled?: boolean;
}): UseQueryResult<ReferralMeResponse> {
  return useQuery({
    queryKey: referralsKeys.me(),
    queryFn: ({ signal }) => api.referrals.me(signal),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  });
}

/**
 * Cursor-paginated downline list for one tier. Infinite query so the page can
 * "Show more" without resetting scroll.
 *
 * `initialPageParam` is explicitly typed to the union `string | undefined` so
 * the inferred `pageParam` in `queryFn` matches what `getNextPageParam` returns
 * (a cursor string for subsequent pages, undefined for the very first call).
 */
export function useReferralDownline(
  tier: ReferralTier,
  options?: { enabled?: boolean; limit?: number },
): UseInfiniteQueryResult<InfiniteData<ReferralListResponse>> {
  const limit = options?.limit ?? 20;
  return useInfiniteQuery<
    ReferralListResponse,
    Error,
    InfiniteData<ReferralListResponse>,
    ReturnType<typeof referralsKeys.list>,
    string | undefined
  >({
    queryKey: referralsKeys.list(tier),
    queryFn: ({ signal, pageParam }) =>
      api.referrals.list({ tier, cursor: pageParam, limit }, signal),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.meta.nextCursor ?? undefined,
    enabled: options?.enabled ?? true,
    staleTime: 15_000,
  });
}

/**
 * Public preview of an invite code (used by the register page's "invited by"
 * chip). `enabled` gates the fetch on a non-empty code; the API always returns
 * 200 so the chip cleanly hides on `valid: false`.
 */
export function useReferralLookup(
  code: string | null | undefined,
  options?: { enabled?: boolean },
): UseQueryResult<ReferralLookupResponse> {
  const trimmed = (code ?? '').trim();
  return useQuery({
    queryKey: referralsKeys.lookup(trimmed),
    queryFn: ({ signal }) => api.referrals.lookup(trimmed, signal),
    enabled: (options?.enabled ?? true) && trimmed.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * `POST /referrals/bind` — attach the just-registered user to an inviter. The
 * caller fires this exactly once right after a successful signup when the form
 * carried a `?ref=` code. On success we invalidate the `me` cache so the
 * dashboard's totals refresh.
 */
export function useReferralBind() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: ReferralBindDto) => api.referrals.bind(dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: referralsKeys.me() });
    },
  });
}
