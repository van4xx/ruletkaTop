'use client';

/**
 * TanStack Query hooks for the friends domain, wired to the REST contract:
 *   GET    /friends                 → FriendSummary[]   (accepted friends)
 *   POST   /friends/request         → Friendship        (send a request)
 *   POST   /friends/:id/accept      → Friendship        (accept a request)
 *   DELETE /friends/:id             → 204               (remove / decline)
 *   POST   /blocks                  → Block             (block a user)
 *
 * Live presence is layered on top of the cached list by {@link usePresence}
 * (socket `presence:online` / `presence:offline`).
 *
 * Incoming/outgoing pending requests come from `GET /friends/requests`
 * (`{ incoming, outgoing }`, see {@link useFriendRequests}); incoming requests
 * also arrive live over the socket as `notif:new` (kind: 'friend_request'),
 * which the page uses to invalidate the query so the list refreshes.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  Block,
  CreateBlockDto,
  FriendRequestDto,
  FriendRequestsResponse,
  Friendship,
  FriendSummary,
} from '@ruletka/shared-types';

import { api } from '@/lib/api';

export const friendsKeys = {
  all: ['friends'] as const,
  list: () => [...friendsKeys.all, 'list'] as const,
  requests: () => [...friendsKeys.all, 'requests'] as const,
};

// ─────────────────────────────── Queries ──────────────────────────────
export function useFriends(): UseQueryResult<FriendSummary[]> {
  return useQuery({
    queryKey: friendsKeys.list(),
    // Backend paginates: { items, nextCursor, hasMore } — unwrap to the array
    // the consumers expect.
    queryFn: () =>
      api
        .request<{ items: FriendSummary[]; nextCursor: string | null; hasMore: boolean }>('/friends')
        .then((r) => r.items),
    staleTime: 30_000,
  });
}

/**
 * The caller's pending friend requests, both directions
 * (`GET /friends/requests` → `{ incoming, outgoing }`). Gate behind auth at the
 * call site (`enabled`) so it doesn't fire for signed-out visitors.
 */
export function useFriendRequests(
  options?: { enabled?: boolean },
): UseQueryResult<FriendRequestsResponse> {
  return useQuery({
    queryKey: friendsKeys.requests(),
    queryFn: ({ signal }) => api.friends.requests(signal),
    enabled: options?.enabled ?? true,
    staleTime: 15_000,
  });
}

// ────────────────────────────── Mutations ─────────────────────────────
export function useSendFriendRequest() {
  return useMutation({
    mutationFn: (recipientId: string) => {
      const dto: FriendRequestDto = { recipientId };
      return api.request<Friendship>('/friends/request', { method: 'POST', json: dto });
    },
  });
}

export function useAcceptFriendRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (friendshipId: string) =>
      api.request<Friendship>(`/friends/${friendshipId}/accept`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: friendsKeys.list() });
      void qc.invalidateQueries({ queryKey: friendsKeys.requests() });
    },
  });
}

/**
 * Remove an accepted friendship OR decline an incoming / cancel an outgoing
 * pending request — all the same `DELETE /friends/:id` route, keyed by
 * `friendshipId`. Optimistically drops the row from BOTH the friends list and
 * the pending-requests inbox, reconciling on error/settle.
 */
export function useRemoveFriendship() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (friendshipId: string) =>
      api.request<void>(`/friends/${friendshipId}`, { method: 'DELETE' }),
    // Optimistically drop the friend from the cached list and the requests inbox.
    onMutate: async (friendshipId: string) => {
      await qc.cancelQueries({ queryKey: friendsKeys.list() });
      await qc.cancelQueries({ queryKey: friendsKeys.requests() });
      const previousList = qc.getQueryData<FriendSummary[]>(friendsKeys.list());
      const previousRequests = qc.getQueryData<FriendRequestsResponse>(friendsKeys.requests());
      if (previousList) {
        qc.setQueryData<FriendSummary[]>(
          friendsKeys.list(),
          previousList.filter((f) => f.friendshipId !== friendshipId),
        );
      }
      if (previousRequests) {
        qc.setQueryData<FriendRequestsResponse>(friendsKeys.requests(), {
          incoming: previousRequests.incoming.filter((r) => r.friendshipId !== friendshipId),
          outgoing: previousRequests.outgoing.filter((r) => r.friendshipId !== friendshipId),
        });
      }
      return { previousList, previousRequests };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previousList) qc.setQueryData(friendsKeys.list(), ctx.previousList);
      if (ctx?.previousRequests) qc.setQueryData(friendsKeys.requests(), ctx.previousRequests);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: friendsKeys.list() });
      void qc.invalidateQueries({ queryKey: friendsKeys.requests() });
    },
  });
}

export function useBlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (blockedUserId: string) => {
      const dto: CreateBlockDto = { blockedUserId };
      return api.request<Block>('/blocks', { method: 'POST', json: dto });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: friendsKeys.list() });
    },
  });
}
