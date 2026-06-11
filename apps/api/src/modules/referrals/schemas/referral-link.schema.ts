import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * One per user. The user's shareable referral code + denormalised lifetime
 * aggregates surfaced on `/referrals/me` so the dashboard reads are a single
 * indexed lookup rather than a per-tier count + a per-tier sum across
 * `referraledges`. The aggregates are advanced atomically inside the same
 * `findOneAndUpdate` that records the reward (see
 * {@link ReferralsService.creditReferralChain}); the row is fully
 * reconstructible from `referraledges` + the wallet ledger.
 *
 * Indexes — `userId` and `code` are both UNIQUE. The link is idempotent per
 * user (a re-call of `ensureLink` converges on the same row) and the code is
 * the public handle ( `https://ruletka.top/register?ref={code}` ) so collisions
 * MUST be impossible.
 */
@Schema({ collection: 'referrallinks', timestamps: true })
export class ReferralLink {
  /** Owning account. Unique (1:1 with users). */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId!: Types.ObjectId;

  /**
   * Public 8-char alphanumeric code. UPPER-CASE on disk so look-ups are
   * case-insensitive without an additional collation: the controller upper-cases
   * the inbound `?ref=` / `bind { code }` before hitting the index.
   */
  @Prop({ required: true, type: String })
  code!: string;

  /**
   * Lifetime number of direct sign-ups. Denormalised mirror of
   * `referraledges.count({ inviterId, tier: 1 })`; advanced when a T1 edge is
   * inserted so the `/referrals/me` read does not re-aggregate the chain.
   */
  @Prop({ required: true, default: 0, min: 0, type: Number })
  totalSignups!: number;

  /**
   * Lifetime sum of coins earned via the referral program across all three
   * tiers. The CAP gate (see {@link REFERRAL_LIFETIME_CAP_COINS}) is enforced
   * against this counter, so once it reaches the cap the sweeper stops
   * crediting this inviter — defence against a small number of whales pumping
   * a single inviter.
   */
  @Prop({ required: true, default: 0, min: 0, type: Number })
  totalEarnedCoins!: number;

  // `createdAt` / `updatedAt` added by `timestamps: true`.
}

export type ReferralLinkDocument = HydratedDocument<ReferralLink>;

export const ReferralLinkSchema = SchemaFactory.createForClass(ReferralLink);

// ── Indexes ────────────────────────────────────────────────────────────────
// One link per account; primary lookup key + the `ensureLink` upsert target.
ReferralLinkSchema.index({ userId: 1 }, { unique: true });
// Public handle — must collide-never. The lookup endpoint hits this directly.
ReferralLinkSchema.index({ code: 1 }, { unique: true });
