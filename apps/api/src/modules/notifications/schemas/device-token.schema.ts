import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import type { DevicePushTokenDto } from '@ruletka/shared-types';

/** Mobile push platforms (kept in sync with `devicePushTokenSchema`). */
const PUSH_PLATFORMS: readonly DevicePushTokenDto['platform'][] = ['android', 'ios', 'web'];

/**
 * A mobile push token (FCM / APNs) registered for a user's device. Mirrors
 * `devicePushTokenSchema` in shared-types.
 *
 * `token` is the unique key (one row per device token); re-registering the same
 * token upserts. The {@link MobilePushProvider} sends through this token; a
 * keyless deployment (no Firebase creds) is a no-op so dev runs without secrets.
 */
@Schema({ collection: 'device_tokens', timestamps: true })
export class DeviceToken {
  /** Owning account (a user may have several devices). */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId!: Types.ObjectId;

  /** FCM registration token / APNs device token — the unique key. */
  @Prop({ required: true, type: String })
  token!: string;

  /** Originating platform. */
  @Prop({ required: true, enum: PUSH_PLATFORMS, type: String })
  platform!: DevicePushTokenDto['platform'];

  // `createdAt` / `updatedAt` added by `timestamps: true`.
}

export type DeviceTokenDocument = HydratedDocument<DeviceToken>;

export const DeviceTokenSchema = SchemaFactory.createForClass(DeviceToken);

// ── Indexes ──────────────────────────────────────────────────────────────────
// One row per device token (re-register upserts; cleanup deletes by token).
DeviceTokenSchema.index({ token: 1 }, { unique: true });
// Fan-out lookup: all of a user's device tokens.
DeviceTokenSchema.index({ userId: 1 });
