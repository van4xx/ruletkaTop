import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import type { GiftContext } from '@ruletka/shared-types';

/** Surfaces a gift can be sent from (kept in sync with `giftContextSchema`). */
const GIFT_CONTEXTS: readonly GiftContext[] = ['call', 'chat', 'profile'];

/**
 * Immutable record of one gift being sent from one user to another.
 *
 * IMPORTANT — cross-module contract: the `profiles` module reads this
 * collection directly by its Mongo name (`gifttransactions`) to render a user's
 * received gifts, querying `{ toUserId: <ObjectId> }`. The collection name and
 * the ObjectId-typed `fromUserId`/`toUserId`/`giftId` fields below MUST stay
 * stable for that read path to keep working.
 */
@Schema({ collection: 'gifttransactions', timestamps: { createdAt: true, updatedAt: false } })
export class GiftTransaction {
  /** Sender (charged `priceCoins`). */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  fromUserId!: Types.ObjectId;

  /** Recipient (the gift is shown on their profile / in the surface). */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  toUserId!: Types.ObjectId;

  /** Which catalogue {@link Gift} was sent. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'Gift' })
  giftId!: Types.ObjectId;

  /** Coins charged at send time (denormalised from the gift's price). */
  @Prop({ required: true, min: 0, type: Number })
  priceCoins!: number;

  /** Surface the gift was sent from. */
  @Prop({ required: true, enum: GIFT_CONTEXTS, type: String })
  context!: GiftContext;

  /** Optional short note attached by the sender. */
  @Prop({ required: false, default: null, type: String })
  message!: string | null;

  // `createdAt` added by `timestamps`; `updatedAt` disabled (rows are immutable).
}

export type GiftTransactionDocument = HydratedDocument<GiftTransaction>;

export const GiftTransactionSchema = SchemaFactory.createForClass(GiftTransaction);

// ── Indexes (PROJECT_SPEC §6) ──────────────────────────────────────────────
// Recipient lookups, newest first (received-gifts list on a profile).
GiftTransactionSchema.index({ toUserId: 1, createdAt: -1 });
// Sender history (audit / "gifts I sent").
GiftTransactionSchema.index({ fromUserId: 1, createdAt: -1 });
