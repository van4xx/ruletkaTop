'use client';

/**
 * The authoritative unread-notifications count for the header badge.
 *
 * Backed by `GET /notifications/unread-count` (a cheap server count that is
 * correct across devices), kept live by the shared socket: every `notif:new`
 * bumps the cached count by one. Read actions elsewhere (the center, the bell)
 * patch the same cache key, so the badge stays in sync without extra fetches.
 *
 * Exactly-once bumps: several components may mount `useUnreadCount` at the same
 * time (header bell + open center), so each would otherwise increment the count
 * on the same socket delivery. A module-scoped seen-set de-dupes by id, so a
 * given `notif:new` bumps the count once no matter how many listeners fire.
 *
 * Only fetches when authenticated — the endpoint is credentialed.
 */
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { UnreadCount } from '@ruletka/shared-types';
import { useAuth } from '@/features/auth';
import { useSocket, useSocketEvent } from '@/features/chat/lib/use-socket';
import { notificationsApi, notificationKeys } from './api';

/**
 * Ids already counted this session — guards against duplicate bump calls when
 * multiple listeners fire for the same delivery. Capped so a very long session
 * can't grow it without bound (recent ids are all that matter for de-duping
 * near-simultaneous fan-out).
 */
const countedIds = new Set<string>();
const COUNTED_CAP = 500;

/** Bump the cached unread count by one (used on a fresh `notif:new`). */
export function prependToUnreadCount(queryClient: QueryClient): void {
  queryClient.setQueryData<UnreadCount>(notificationKeys.unread(), (prev) => ({
    count: (prev?.count ?? 0) + 1,
  }));
}

/** Bump the count exactly once for a given notification id. */
function bumpOnce(queryClient: QueryClient, id: string): void {
  if (countedIds.has(id)) return;
  if (countedIds.size >= COUNTED_CAP) {
    // Drop the oldest insertion to keep the guard bounded.
    const oldest = countedIds.values().next().value;
    if (oldest !== undefined) countedIds.delete(oldest);
  }
  countedIds.add(id);
  prependToUnreadCount(queryClient);
}

export interface UseUnreadCountResult {
  count: number;
  isLoading: boolean;
}

export function useUnreadCount(): UseUnreadCountResult {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: notificationKeys.unread(),
    queryFn: ({ signal }) => notificationsApi.unreadCount(signal),
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  // Keep the badge live: a new socket delivery increments the count even when
  // the history list isn't mounted (de-duped by id across listeners). `notif:new`
  // is delivered on the /mm gateway, so we bind there.
  useSocket('/mm');
  useSocketEvent(
    'notif:new',
    (n) => {
      if (isAuthenticated) bumpOnce(queryClient, n.id);
    },
    '/mm',
  );

  return { count: query.data?.count ?? 0, isLoading: query.isLoading };
}
