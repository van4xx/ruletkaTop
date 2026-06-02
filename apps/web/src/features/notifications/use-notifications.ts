'use client';

/**
 * Notifications feature hook — the public surface for the /notifications center.
 *
 * Real backend wiring:
 *  - History is a cursor-paginated infinite query against `GET /notifications`.
 *  - The unread badge count comes from `GET /notifications/unread-count` (a
 *    cheap server count, authoritative across devices) — see
 *    {@link useUnreadCount}.
 *  - `markRead` / `markAllRead` POST to the server and optimistically patch the
 *    cached pages + the unread count.
 *
 * Realtime: the shared socket's `notif:new` delivery is folded straight into
 * the history query cache (prepended to the first page, de-duped by id) and the
 * unread count is bumped — so an open center and the header bell both light up
 * instantly without a refetch.
 *
 * Auth: history/count only fetch when authenticated (the endpoints are
 * credentialed; querying anonymously would just 401).
 */
import { useCallback, useMemo } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type { AppNotification } from '@ruletka/shared-types';
import { useAuth } from '@/features/auth';
import { useSocket, useSocketEvent } from '@/features/chat/lib/use-socket';
import type { NotificationFeedPage } from '@/lib/api';
import { notificationsApi, notificationKeys } from './api';
import { toStoredNotification, type StoredNotification } from './store';
import { useUnreadCount } from './use-unread-count';

const PAGE_SIZE = 20;

export interface UseNotificationsResult {
  items: StoredNotification[];
  unread: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  /** Fetch the next page of history (no-op when exhausted / already loading). */
  fetchMore: () => void;
  hasMore: boolean;
  isFetchingMore: boolean;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

type FeedCache = InfiniteData<NotificationFeedPage, string | undefined>;

/**
 * Prepend a freshly-arrived notification to the first cached history page,
 * de-duping by id. Pure cache transform reused by the socket listener.
 */
export function prependToFeed(prev: FeedCache | undefined, n: StoredNotification): FeedCache {
  if (!prev || prev.pages.length === 0) {
    return {
      pages: [{ items: [n], nextCursor: null }],
      pageParams: [undefined],
    };
  }
  const [first, ...rest] = prev.pages;
  // `prev.pages` is non-empty here (guarded above), but array indexing isn't
  // narrowed under noUncheckedIndexedAccess — bail defensively to satisfy types.
  if (!first) return prev;
  if (first.items.some((it) => it.id === n.id)) return prev;
  return {
    ...prev,
    pages: [{ ...first, items: [n, ...first.items] }, ...rest],
  };
}

/** Patch the read-state of one (or every) cached history row. */
function patchReadInFeed(prev: FeedCache | undefined, id: string | 'ALL'): FeedCache | undefined {
  if (!prev) return prev;
  return {
    ...prev,
    pages: prev.pages.map((page) => ({
      ...page,
      items: page.items.map((it) =>
        id === 'ALL' || it.id === id ? { ...it, read: true } : it,
      ),
    })),
  };
}

export function useNotifications(): UseNotificationsResult {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const listKey = notificationKeys.list(false);

  const query = useInfiniteQuery({
    queryKey: listKey,
    queryFn: ({ pageParam, signal }) =>
      notificationsApi.list({ cursor: pageParam, limit: PAGE_SIZE }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: isAuthenticated,
    staleTime: 15_000,
  });

  const { count: unread } = useUnreadCount();

  const items = useMemo<StoredNotification[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  // ── Realtime: fold every `notif:new` into the history cache ──
  // The unread badge is bumped centrally by `useUnreadCount` (which this hook
  // also consumes), so we only touch the feed cache here — no double counting
  // when both the center and the header bell are mounted.
  useSocket();
  useSocketEvent('notif:new', (n: AppNotification) => {
    const stored = toStoredNotification(n);
    queryClient.setQueryData<FeedCache>(listKey, (prev) => prependToFeed(prev, stored));
  });

  // ── Read mutations (optimistic; server is source of truth) ──
  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onMutate: (id) => {
      queryClient.setQueryData<FeedCache>(listKey, (prev) => patchReadInFeed(prev, id));
      queryClient.setQueryData(notificationKeys.unread(), (prev: { count: number } | undefined) =>
        prev ? { count: Math.max(0, prev.count - 1) } : prev,
      );
    },
    onError: () => void query.refetch(),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onMutate: () => {
      queryClient.setQueryData<FeedCache>(listKey, (prev) => patchReadInFeed(prev, 'ALL'));
      queryClient.setQueryData(notificationKeys.unread(), { count: 0 });
    },
    onError: () => void query.refetch(),
  });

  const markRead = useCallback(
    (id: string) => {
      // Don't re-POST an already-read row.
      const row = items.find((it) => it.id === id);
      if (row && !row.read) markReadMutation.mutate(id);
    },
    [items, markReadMutation],
  );
  const markAllRead = useCallback(() => {
    if (unread > 0) markAllReadMutation.mutate();
  }, [unread, markAllReadMutation]);

  return {
    items,
    unread,
    markRead,
    markAllRead,
    fetchMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    hasMore: Boolean(query.hasNextPage),
    isFetchingMore: query.isFetchingNextPage,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}
