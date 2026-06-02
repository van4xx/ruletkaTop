'use client';

/**
 * Profile data layer.
 *   GET   /profiles/:id          → PublicProfile   (public; counts a view)
 *   GET   /profiles/:id/gifts    → GiftTransaction[] | { items } (received, newest-first)
 *   PATCH /profiles/me           → PublicProfile   (own profile edit)
 *
 * The gift showcase joins received `GiftTransaction`s to the public gift
 * catalogue (reused from the economy/gifts feature) to render glyphs + rarity.
 */
import { useEffect, useMemo } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  Gift,
  GiftTransaction,
  PublicProfile,
  TopLane,
  UpdateProfileDto,
} from '@ruletka/shared-types';

import { api } from '@/lib/api';
import { useGifts } from '@/features/gifts/use-gifts';
import { useMe } from '@/features/economy/use-me';
import { useTopFeed } from '@/features/top/use-top';

export const profileKeys = {
  all: ['profile'] as const,
  detail: (id: string) => [...profileKeys.all, 'detail', id] as const,
  gifts: (id: string) => [...profileKeys.all, 'gifts', id] as const,
};

export function useProfile(id: string | undefined): UseQueryResult<PublicProfile> {
  return useQuery({
    queryKey: profileKeys.detail(id ?? 'unknown'),
    queryFn: () => api.request<PublicProfile>(`/profiles/${id}`),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

export interface ReceivedGift extends GiftTransaction {
  gift?: Gift;
}

/** A cursor-paginated list envelope (`{ items }`) some list endpoints return. */
interface ListEnvelope<T> {
  items: T[];
}

function isListEnvelope<T>(value: unknown): value is ListEnvelope<T> {
  return typeof value === 'object' && value !== null && Array.isArray((value as { items?: unknown }).items);
}

/**
 * Received gifts joined to the catalogue (so we have title/glyph/rarity).
 *
 * The endpoint currently returns a bare array, but list endpoints across the
 * API are migrating to a `{ items }` envelope — this fetcher tolerates BOTH so
 * the showcase keeps working either way. Also exposes the total coin value of
 * received gifts (sum of each transaction's `priceCoins`) for the stats strip.
 */
export function useProfileGifts(id: string | undefined): {
  gifts: ReceivedGift[];
  /** Sum of `priceCoins` across all received gifts (showcase "value"). */
  totalValueCoins: number;
  /** Number of received-gift transactions (not de-duplicated). */
  totalCount: number;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const txQuery = useQuery({
    queryKey: profileKeys.gifts(id ?? 'unknown'),
    queryFn: async () => {
      const res = await api.request<GiftTransaction[] | ListEnvelope<GiftTransaction>>(
        `/profiles/${id}/gifts`,
      );
      return isListEnvelope<GiftTransaction>(res) ? res.items : res;
    },
    enabled: Boolean(id),
    staleTime: 60_000,
  });
  const catalogue = useGifts();

  const gifts = useMemo<ReceivedGift[]>(() => {
    const byId = new Map((catalogue.data ?? []).map((g) => [g.id, g]));
    return (txQuery.data ?? []).map((tx) => ({ ...tx, gift: byId.get(tx.giftId) }));
  }, [txQuery.data, catalogue.data]);

  const totalValueCoins = useMemo(
    () => gifts.reduce((sum, g) => sum + (g.priceCoins ?? g.gift?.priceCoins ?? 0), 0),
    [gifts],
  );

  return {
    gifts,
    totalValueCoins,
    totalCount: gifts.length,
    isLoading: txQuery.isLoading,
    isError: txQuery.isError,
    refetch: () => void txQuery.refetch(),
  };
}

/**
 * Whether a user currently holds a Top-feed placement, derived from the live
 * two-lane feed. Returns the lane when placed (so the UI can theme it) or
 * `null` otherwise. Degrades to `null` while the feed loads / on error.
 */
export function useTopPlacement(userId: string | undefined): {
  lane: TopLane | null;
  isPlaced: boolean;
  isLoading: boolean;
} {
  const feed = useTopFeed();
  const lane = useMemo<TopLane | null>(() => {
    if (!userId || !feed.data) return null;
    if (feed.data.left.some((p) => p.userId === userId)) return 'left';
    if (feed.data.right.some((p) => p.userId === userId)) return 'right';
    return null;
  }, [feed.data, userId]);

  return { lane, isPlaced: lane !== null, isLoading: feed.isLoading };
}

/**
 * Keep the own-profile detail cache in sync with the economy "me" cache.
 *
 * The avatar-upload modal (owned by the modals feature) writes the updated
 * profile to `['economy','me']` but not to `['profile','detail',id]` — the key
 * the profile pages read. This subscribes to the economy-me query and mirrors
 * the fresh avatar/nickname/premium/status into the profile detail cache, so a
 * modal avatar change reflects instantly in the hero without a reload.
 */
export function useSyncOwnProfileCache(userId: string | undefined): void {
  const qc = useQueryClient();
  const me = useMe();
  const meData = me.data;
  useEffect(() => {
    if (!userId || !meData || meData.id !== userId) return;
    qc.setQueryData<PublicProfile | undefined>(profileKeys.detail(userId), (prev) =>
      prev
        ? {
            ...prev,
            avatarUrl: meData.avatarUrl,
            nickname: meData.nickname,
            isPremium: meData.isPremium,
            status: meData.status,
          }
        : prev,
    );
  }, [qc, userId, meData]);
}

/** Update the caller's own profile and refresh cached copies. */
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateProfileDto) =>
      api.request<PublicProfile>('/profiles/me', { method: 'PATCH', json: dto }),
    onSuccess: (updated) => {
      qc.setQueryData(profileKeys.detail(updated.id), updated);
      // Keep the economy "me" query (avatar/nickname/isPremium) and the auth
      // session's `/auth/me` in sync so the header + dashboard update instantly.
      qc.setQueryData(['economy', 'me'], updated);
      void qc.invalidateQueries({ queryKey: ['economy', 'me'] });
      void qc.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
}
