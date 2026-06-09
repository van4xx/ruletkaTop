'use client';

/**
 * Feature-local TanStack Query hooks wrapping the EXISTING base `api` client for
 * the endpoints the roulette call overlay needs. These routes are not yet part
 * of `api`'s typed groups, so we go through the generic `api.request` escape
 * hatch with shared-types DTOs for full type-safety.
 *
 * Endpoints used (all under the API global prefix):
 *   GET  /turn/credentials   → ICE servers for RTCPeerConnection
 *   GET  /gifts              → catalogue for the in-call gift picker
 *   POST /gifts/send         → send a gift to the peer
 *   POST /reports            → report the peer
 *   POST /blocks             → block the peer
 *   POST /friends/request    → send a friend request to the peer
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateBlockDto,
  CreateReportDto,
  FriendRequestDto,
  Friendship,
  Gift,
  GiftTransaction,
  Report,
  SendGiftDto,
} from '@ruletka/shared-types';

import { api } from '@/lib/api';
import { BLOCKS_KEY } from '@/features/settings/use-settings';
import { economyKeys } from '@/features/economy/api';
import type { TurnCredentials } from '@/lib/webrtc';

/**
 * Fetch fresh ICE credentials. We intentionally keep them short-lived in the
 * cache (the API credential is ~1h) and never retry hard, since we have a STUN
 * fallback at the call site.
 */
export function useTurnCredentials(enabled: boolean) {
  return useQuery({
    queryKey: ['turn', 'credentials'],
    queryFn: () => api.request<TurnCredentials>('/turn/credentials'),
    enabled,
    staleTime: 50 * 60_000, // ~50min, under the ~1h TTL
    gcTime: 60 * 60_000,
    retry: 1,
  });
}

/** The gift catalogue for the in-call gift picker. */
export function useGifts(enabled: boolean) {
  return useQuery({
    queryKey: ['gifts', 'catalogue'],
    queryFn: () => api.request<Gift[]>('/gifts'),
    enabled,
    staleTime: 10 * 60_000,
  });
}

export function useSendGift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: SendGiftDto) =>
      api.request<GiftTransaction>('/gifts/send', { method: 'POST', json: dto }),
    // Sending debits the caller's wallet server-side, so refresh the balance +
    // ledger — otherwise the header coin pill stays stale after an in-call gift.
    // Mirrors the canonical economy `useSendGift` (`useEconomyInvalidation`).
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: economyKeys.wallet() });
      void queryClient.invalidateQueries({ queryKey: economyKeys.transactions() });
    },
  });
}

export function useReportUser() {
  return useMutation({
    mutationFn: (dto: CreateReportDto) =>
      api.request<Report>('/reports', { method: 'POST', json: dto }),
  });
}

export function useBlockUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateBlockDto) =>
      api.request<void>('/blocks', { method: 'POST', json: dto }),
    // A block created mid-call must show up in Settings → Blocked users, so
    // refresh that cached list (otherwise the settings tab is stale until reload).
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BLOCKS_KEY });
    },
  });
}

export function useAddFriend() {
  return useMutation({
    mutationFn: (dto: FriendRequestDto) =>
      api.request<Friendship>('/friends/request', { method: 'POST', json: dto }),
  });
}
