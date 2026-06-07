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
import { useMemo } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
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

/** Page size requested per `GET /friends` round-trip (matches the API default). */
const PAGE_SIZE = 20;

/** One cursor-paginated page of accepted friends (`GET /friends`). */
interface FriendPage {
  items: FriendSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** The cached infinite-query shape for the friends list. */
type FriendsCache = InfiniteData<FriendPage, string | undefined>;

/**
 * The accepted-friends list, surfaced as a cursor-paginated infinite query
 * (`GET /friends?cursor&limit` → `{ items, nextCursor, hasMore }`). Pages are
 * flattened into a single `items` array for consumers; `fetchMore` loads the
 * next page (no-op once exhausted / already loading).
 *
 * Mirrors the result-object convention used by {@link useNotifications} and
 * {@link useProfileSearch} so a "Load more" affordance can be wired the same way.
 */
export interface UseFriendsResult {
  /** All loaded friends, flattened across every fetched page. */
  items: FriendSummary[];
  isLoading: boolean;
  isError: boolean;
  /** Whether another page can be loaded. */
  hasMore: boolean;
  /** True while a follow-up page is in flight. */
  isFetchingMore: boolean;
  /** Load the next page (no-op when exhausted / already loading). */
  fetchMore: () => void;
  refetch: () => void;
}

// ─────────────────────────────── Queries ──────────────────────────────
export function useFriends(): UseFriendsResult {
  const query = useInfiniteQuery<FriendPage>({
    queryKey: friendsKeys.list(),
    // Backend paginates: { items, nextCursor, hasMore }. Fetch page-by-page so
    // friend lists past the first 20 stay reachable.
    queryFn: ({ pageParam, signal }) =>
      api.request<FriendPage>('/friends', {
        query: { cursor: pageParam as string | undefined, limit: PAGE_SIZE },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    staleTime: 30_000,
  });

  const items = useMemo<FriendSummary[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  return {
    items,
    isLoading: query.isLoading,
    isError: query.isError,
    hasMore: Boolean(query.hasNextPage),
    isFetchingMore: query.isFetchingNextPage,
    fetchMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    refetch: () => void query.refetch(),
  };
}

/**
 * Drop a friendship from every cached page of the infinite friends list,
 * keyed by `friendshipId`. Pure cache transform reused by the optimistic
 * remove/block mutations.
 */
function removeFromFriendsCache(
  prev: FriendsCache | undefined,
  friendshipId: string,
): FriendsCache | undefined {
  if (!prev) return prev;
  return {
    ...prev,
    pages: prev.pages.map((page) => ({
      ...page,
      items: page.items.filter((f) => f.friendshipId !== friendshipId),
    })),
  };
}

/**
 * The caller's pending friend requests, both directions
 * (`GET /friends/requests` → `{ incoming, outgoing }`). Gate behind auth at the
 * call site (`enabled`) so it doesn't fire for signed-out visitors.
 */
export function useFriendRequests(options?: {
  enabled?: boolean;
}): UseQueryResult<FriendRequestsResponse> {
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
      const previousList = qc.getQueryData<FriendsCache>(friendsKeys.list());
      const previousRequests = qc.getQueryData<FriendRequestsResponse>(friendsKeys.requests());
      if (previousList) {
        qc.setQueryData<FriendsCache>(
          friendsKeys.list(),
          removeFromFriendsCache(previousList, friendshipId),
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
