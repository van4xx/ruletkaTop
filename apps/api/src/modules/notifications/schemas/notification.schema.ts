import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import type { NotificationKind } from '@ruletka/shared-types';

/** Notification kinds (kept in sync with `notificationKindSchema`). */
const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'friend_request',
  'message',
  'gift',
  'call',
  'system',
];

/**
 * A persisted notification in a user's in-app notifications center.
 *
 * One row per delivered notification, addressed to `recipientUserId`. The
 * realtime `notif:new` event carries a lightweight projection of this row
 * (`AppNotification` = id/kind/title/body/createdAt); the full record (with
 * `read`, `actorId`, `link`) is what `GET /notifications` returns and maps to
 * the shared `notificationSchema`.
 */
@Schema({ collection: 'notifications', timestamps: { createdAt: true, updatedAt: false } })
export class Notification {
  /** The account this notification is addressed to. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  recipientUserId!: Types.ObjectId;

  /** Category — drives the icon/grouping on the client. */
  @Prop({ required: true, enum: NOTIFICATION_KINDS, type: String })
  kind!: NotificationKind;

  /** Short headline (e.g. "New friend request"). */
  @Prop({ required: true, type: String })
  title!: string;

  /** Body line (e.g. "Alice wants to be your friend"). */
  @Prop({ required: true, type: String })
  body!: string;

  /** Whether the recipient has seen it. New rows are unread. */
  @Prop({ required: true, default: false, type: Boolean })
  read!: boolean;

  /** The user who triggered it (gift sender, requester, …), if any. */
  @Prop({ required: false, default: null, type: Types.ObjectId, ref: 'User' })
  actorId!: Types.ObjectId | null;

  /** Optional in-app deep link (e.g. `/friends/requests`, `/profile/<id>`). */
  @Prop({ required: false, default: null, type: String })
  link!: string | null;

  // `createdAt` added by `timestamps`; `updatedAt` disabled (rows are immutable
  // except for the `read` flag).
}

export type NotificationDocument = HydratedDocument<Notification>;

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// ── Indexes ──────────────────────────────────────────────────────────────────
// Primary feed query: a recipient's notifications, newest first (also the
// keyset-pagination key alongside `_id`).
NotificationSchema.index({ recipientUserId: 1, createdAt: -1 });
// Unread badge + "mark all read": filter a recipient's unread rows.
NotificationSchema.index({ recipientUserId: 1, read: 1 });
