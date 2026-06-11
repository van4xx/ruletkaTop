import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * Singleton cursor row for the referral reward sweep.
 *
 * Holds the LATEST `cointransactions._id` the {@link ReferralRewardProcessor}
 * has fanned out 3-tier rewards for. The sweep reads `purchase` ledger rows
 * with `_id > lastLedgerId`, walks the invitee's chain, and advances this
 * watermark.
 *
 * IMPORTANT: this row is a denormalised optimisation — NOT the source of
 * truth. Even with a wiped cursor the wallet's partial-unique `(type, refId)`
 * index guarantees AT-MOST-ONCE crediting per (tier, purchaser, ledger row),
 * so a full ledger replay self-heals safely. We keep the cursor purely to keep
 * the sweep's per-pass scan bounded.
 *
 * Stored as a singleton (`key: 'singleton'`, unique) so the sweep can `upsert`
 * idempotently across replicas / restarts.
 */
@Schema({ collection: 'referralcursors', timestamps: true })
export class ReferralCursor {
  /** Fixed singleton key used by the sweep's upsert. */
  static readonly SINGLETON_KEY = 'singleton';

  /** Always `'singleton'`. Unique index below. */
  @Prop({ required: true, type: String })
  key!: string;

  /**
   * Highest processed `cointransactions._id`, or `null` until the very first
   * sweep pass advances it. The `_id` ordering coincides with the insertion
   * order of ledger rows, so a `$gt` scan is monotonic and gap-free.
   */
  @Prop({ required: false, default: null, type: Types.ObjectId })
  lastLedgerId!: Types.ObjectId | null;

  // `createdAt` / `updatedAt` added by `timestamps: true`.
}

export type ReferralCursorDocument = HydratedDocument<ReferralCursor>;

export const ReferralCursorSchema = SchemaFactory.createForClass(ReferralCursor);

// Singleton enforcement — only one row ever exists.
ReferralCursorSchema.index({ key: 1 }, { unique: true });
