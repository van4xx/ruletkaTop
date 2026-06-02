import { z } from 'zod';
import { isoDateSchema, objectIdSchema } from './common';

/**
 * Persistent notifications contract.
 *
 * Two related shapes:
 *  - {@link notificationSchema} — a STORED notification record (has `read`,
 *    `actor`, `link`), returned by `GET /notifications`.
 *  - the lightweight realtime push event is `AppNotification` in `socket.ts`
 *    (emitted on `notif:new`); a stored record is created alongside it.
 *
 * Delivery beyond the in-app center is via Web Push (browser) / FCM·APNs
 * (mobile): a client registers a {@link pushSubscriptionSchema} and the server
 * fans out on the same events.
 */

export const notificationKindSchema = z.enum([
  'friend_request',
  'message',
  'gift',
  'call',
  'system',
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

/** A stored notification record (the in-app notifications center). */
export const notificationSchema = z.object({
  id: objectIdSchema,
  kind: notificationKindSchema,
  title: z.string(),
  body: z.string(),
  /** Whether the recipient has seen it. */
  read: z.boolean(),
  /** The user who triggered it (sender of a gift/message/request), if any. */
  actorId: objectIdSchema.nullable().optional(),
  /** Optional in-app deep link (e.g. `/chat/<id>`, `/profile/<id>`). */
  link: z.string().nullable().optional(),
  createdAt: isoDateSchema,
});
export type Notification = z.infer<typeof notificationSchema>;

/** Cursor-paginated list query for `GET /notifications`. */
export const listNotificationsQuerySchema = z.object({
  cursor: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** When true, return only unread items. */
  unreadOnly: z.coerce.boolean().optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

/** Unread-count response for the header badge. */
export const unreadCountSchema = z.object({ count: z.number().int().nonnegative() });
export type UnreadCount = z.infer<typeof unreadCountSchema>;

// ── Web Push (browser) subscription — the W3C PushSubscription shape ─────────
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  /** Epoch millis the subscription expires, or null for none. */
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    /** Client public key (ECDH P-256), base64url. */
    p256dh: z.string(),
    /** Client auth secret, base64url. */
    auth: z.string(),
  }),
});
export type PushSubscriptionDto = z.infer<typeof pushSubscriptionSchema>;

/** Register a mobile push token (FCM / APNs) for the calling device. */
export const devicePushTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['android', 'ios', 'web']),
});
export type DevicePushTokenDto = z.infer<typeof devicePushTokenSchema>;
