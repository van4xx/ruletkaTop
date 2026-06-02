'use client';

/**
 * Notifications types + cache helpers.
 *
 * History now comes from the real backend (`GET /notifications`) through
 * TanStack Query (see {@link useNotifications}); the socket `notif:new` event is
 * folded straight into that query cache. This module no longer owns a parallel
 * zustand list — it just exports the row type the presentational components use
 * and the helpers that bridge a live socket {@link AppNotification} into a
 * stored {@link Notification} record.
 *
 * The presentational {@link StoredNotification} is exactly the contract's stored
 * record (it already carries `read`), so the feed, the header bell and the
 * dashboard preview all render the same shape whether a row came from history
 * or just arrived over the wire.
 */
import type { AppNotification, Notification } from '@ruletka/shared-types';

/** A row rendered in the feed — the contract's stored notification record. */
export type StoredNotification = Notification;

/**
 * Lift a lightweight realtime {@link AppNotification} (the socket payload only
 * carries `{ id, kind, title, body, createdAt }`) into a full stored
 * {@link Notification} record so it can be prepended to the history cache. A
 * freshly-arrived notification is unread and has no resolved actor/link yet
 * (the next history refetch backfills those if the server set them).
 */
export function toStoredNotification(n: AppNotification): StoredNotification {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    read: false,
    actorId: null,
    link: null,
    createdAt: n.createdAt,
  };
}
