import type { AppNotification } from '@ruletka/shared-types';

/**
 * Cross-instance channel on which {@link NotificationsService} PUBLISHES a newly
 * created notification, so the realtime gateway — on whichever API node holds
 * the recipient's socket — can emit `notif:new` to that user's per-user room.
 *
 * This MIRRORS the `moderation:action` pattern (see
 * `modules/moderation/moderation.constants.ts` + the matchmaking gateway's
 * subscriber): the publisher (this module) has no value-dependency on the
 * gateway, and the gateway has no dependency on this module — they agree only on
 * the channel NAME and the JSON wire shape. This keeps the import graph a DAG
 * (no `NotificationsModule ↔ MatchmakingModule` cycle).
 *
 * WIRE CONTRACT: the message body is JSON `{ userId, notification }` where
 * `notification` is an {@link AppNotification} (the lightweight realtime shape:
 * `{ id, kind, title, body, createdAt }`). The {@link MatchmakingGateway}
 * subscribes to this channel and emits `notif:new` to `mm:user:<userId>`. The
 * channel name MUST stay identical on both sides.
 */
export const NOTIFICATION_NEW_CHANNEL = 'notif:new';

/** Shape published on {@link NOTIFICATION_NEW_CHANNEL} (JSON-encoded). */
export interface NotificationNewMessage {
  /** Recipient whose per-user room should receive the `notif:new` emit. */
  userId: string;
  /** The lightweight realtime payload delivered on `notif:new`. */
  notification: AppNotification;
}
