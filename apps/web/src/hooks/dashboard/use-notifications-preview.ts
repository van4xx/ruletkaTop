'use client';

/**
 * Notifications preview for the header bell + the dashboard widget.
 *
 * Real backend wiring:
 *  - `items` is the newest slice of history (`GET /notifications`, first page,
 *    capped) under its OWN query key (`notificationKeys.preview()`) so it never
 *    collides with the infinite list the /notifications center owns.
 *  - `unread` is the authoritative server badge count ({@link useUnreadCount}),
 *    kept live over the socket.
 *  - A live `notif:new` is prepended into the preview cache (de-duped by id) so
 *    the popover updates instantly without a refetch.
 *  - `markAllRead` POSTs `/notifications/read-all` and optimistically clears the
 *    cached count + read-state (and invalidates the center list so it refetches).
 *
 * Auth-gated: nothing fetches for anonymous visitors (the parent also gates the
 * bell to authenticated users).
 */
import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AppNotification } from '@ruletka/shared-types';
import { useAuth } from '@/features/auth';
import { useSocket, useSocketEvent } from '@/features/chat/lib/use-socket';
import { notificationsApi, notificationKeys } from '@/features/notifications/api';
import { toStoredNotification, type StoredNotification } from '@/features/notifications/store';
import { useUnreadCount } from '@/features/notifications/use-unread-count';

/** How many recent notifications the popover shows. */
const PREVIEW_LIMIT = 12;

export interface NotificationsPreview {
  items: StoredNotification[];
  unread: number;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  markAllRead: () => void;
}

export function useNotificationsPreview(): NotificationsPreview {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const previewKey = notificationKeys.preview();

  const query = useQuery({
    queryKey: previewKey,
    queryFn: async ({ signal }) => {
      const page = await notificationsApi.list({ limit: PREVIEW_LIMIT }, signal);
      return page.items;
    },
    enabled: isAuthenticated,
    staleTime: 15_000,
  });

  const { count: unread } = useUnreadCount();

  // Fold realtime deliveries into the preview cache (de-duped by id). `notif:new`
  // is delivered on the /mm gateway, so we bind there.
  useSocket('/mm');
  useSocketEvent(
    'notif:new',
    (n: AppNotification) => {
      queryClient.setQueryData<StoredNotification[]>(previewKey, (prev) => {
        const list = prev ?? [];
        if (list.some((it) => it.id === n.id)) return list;
        return [toStoredNotification(n), ...list].slice(0, PREVIEW_LIMIT);
      });
    },
    '/mm',
  );

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onMutate: () => {
      queryClient.setQueryData(notificationKeys.unread(), { count: 0 });
      queryClient.setQueryData<StoredNotification[]>(previewKey, (prev) =>
        prev ? prev.map((it) => ({ ...it, read: true })) : prev,
      );
    },
    onSettled: () => {
      // Bring the full center list in line with the server after a read-all.
      void queryClient.invalidateQueries({ queryKey: notificationKeys.list(false) });
    },
  });

  const items = useMemo(() => query.data ?? [], [query.data]);
  const refetch = useCallback(() => {
    void query.refetch();
  }, [query]);
  const markAllRead = useCallback(() => {
    if (unread > 0) markAllReadMutation.mutate();
  }, [unread, markAllReadMutation]);

  return {
    items,
    unread,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch,
    markAllRead,
  };
}
