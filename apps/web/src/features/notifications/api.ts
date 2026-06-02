/**
 * Feature-local notifications data layer: the real backend routes plus the
 * TanStack Query keys used to coordinate the header badge, the dashboard
 * preview and the /notifications center.
 *
 * Routes (NestJS NotificationsController):
 *  - `GET  /notifications`              cursor-paginated history
 *  - `GET  /notifications/unread-count` badge count
 *  - `POST /notifications/:id/read`     mark one read
 *  - `POST /notifications/read-all`     mark all read
 *  - `POST /notifications/push/...`     Web Push subscription management
 *
 * Every type is sourced from the `@ruletka/shared-types` contract.
 */
import { api } from '@/lib/api';

/** Re-export the thin api groups so callers import everything from one place. */
export const notificationsApi = api.notifications;

/** Centralised query keys for cache coordination across notification surfaces. */
export const notificationKeys = {
  all: ['notifications'] as const,
  /** The infinite history list on the /notifications center (a page may be
   *  filtered to unread-only). Owned exclusively by the infinite-list query. */
  list: (unreadOnly?: boolean) =>
    [...notificationKeys.all, 'list', { unreadOnly: !!unreadOnly }] as const,
  /** The short, newest slice shown in the header bell + dashboard preview.
   *  Kept under a distinct key so it never collides with the infinite list. */
  preview: () => [...notificationKeys.all, 'preview'] as const,
  /** The unread badge count. */
  unread: () => [...notificationKeys.all, 'unread'] as const,
} as const;
