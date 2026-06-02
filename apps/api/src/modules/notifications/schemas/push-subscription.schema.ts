import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * A browser Web Push subscription (the W3C `PushSubscription` shape) owned by a
 * user. Mirrors `pushSubscriptionSchema` in shared-types.
 *
 * `endpoint` is the unique push-service URL the browser handed us; it is the
 * natural key (one row per browser subscription) so re-subscribing the same
 * browser upserts rather than duplicating. The `web-push` library encrypts the
 * payload with `keys.p256dh` + `keys.auth` and POSTs it to `endpoint`.
 *
 * When a push to this endpoint returns `404`/`410` (subscription gone), the
 * {@link PushService} deletes the row so we stop sending to dead endpoints.
 */
@Schema({ collection: 'push_subscriptions', timestamps: true })
export class PushSubscription {
  /** Owning account (a user may have several browser subscriptions). */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId!: Types.ObjectId;

  /** Push-service endpoint URL — the unique subscription key. */
  @Prop({ required: true, type: String })
  endpoint!: string;

  /** Epoch millis the subscription expires, or `null` for none. */
  @Prop({ required: false, default: null, type: Number })
  expirationTime!: number | null;

  /** Client ECDH P-256 public key (base64url). */
  @Prop({ required: true, type: String })
  p256dh!: string;

  /** Client auth secret (base64url). */
  @Prop({ required: true, type: String })
  auth!: string;

  // `createdAt` / `updatedAt` added by `timestamps: true`.
}

export type PushSubscriptionDocument = HydratedDocument<PushSubscription>;

export const PushSubscriptionSchema = SchemaFactory.createForClass(PushSubscription);

// ── Indexes ──────────────────────────────────────────────────────────────────
// One row per push endpoint (re-subscribe upserts; cleanup deletes by endpoint).
PushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });
// Fan-out lookup: all of a user's subscriptions.
PushSubscriptionSchema.index({ userId: 1 });
