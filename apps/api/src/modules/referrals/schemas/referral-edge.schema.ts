import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import type { ReferralTier } from '@ruletka/shared-types';

/**
 * One row per (inviter, invitee, tier) relationship.
 *
 * When `Alice → Bob` signs up via Alice's code, the binder walks UP the chain
 * from Alice and INSERTS up to three rows:
 *   - { inviterId: Alice, inviteeId: Bob, tier: 1 }   (direct)
 *   - { inviterId: <Alice's inviter>, inviteeId: Bob, tier: 2 } (when present)
 *   - { inviterId: <…their inviter>,   inviteeId: Bob, tier: 3 } (when present)
 *
 * The UNIQUE INDEX on `inviteeId` (NOT a compound — see below) enforces the
 * product rule "one inviter per invitee, set at signup": once Bob has any edge,
 * a second `bind` attempt by Bob hits a duplicate-key error. The compound index
 * `(inviterId, tier)` powers the per-tier downline list (`GET /referrals/me/list?tier=1`)
 * as an index-only range scan.
 *
 * Rows are NEVER mutated or deleted; the relationships are a permanent record
 * for accounting + auditability. `hasMadeFirstPurchase` is the only mutable
 * field — flipped from `false → true` on the invitee's first PAID purchase
 * (the T1 anti-bot gate). It is NOT denormalised across all three tier rows of
 * a single invitee — we always read it from the T1 row (the canonical
 * `(invitee, T1)` row created by the same binder call).
 */
@Schema({ collection: 'referraledges', timestamps: { createdAt: true, updatedAt: false } })
export class ReferralEdge {
  /** The inviter (the upline). Indexed compound below for downline list reads. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  inviterId!: Types.ObjectId;

  /**
   * The invitee (the downline). UNIQUE across all rows for tier=1 so a user
   * can only have ONE direct inviter; the T2/T3 rows for the same invitee share
   * the inviteeId (different inviters), so the unique index is restricted to
   * the T1 row via a partial filter (see index declaration below).
   */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  inviteeId!: Types.ObjectId;

  /** 1 = direct, 2 = indirect, 3 = deep — see shared `ReferralTier`. */
  @Prop({ required: true, enum: [1, 2, 3], type: Number })
  tier!: ReferralTier;

  /**
   * True once the invitee has completed at least one PAID coin PURCHASE
   * (wallet ledger row of type `purchase` with a positive delta). The
   * referral-reward sweeper flips this on the FIRST purchase (T1 anti-bot
   * gate). Stored ONLY on the T1 row — the T2/T3 rows read the T1 row when
   * the downline list needs it.
   */
  @Prop({ required: true, default: false, type: Boolean })
  hasMadeFirstPurchase!: boolean;

  // `createdAt` added by `timestamps`; `updatedAt` disabled (rows are append-only).
}

export type ReferralEdgeDocument = HydratedDocument<ReferralEdge>;

export const ReferralEdgeSchema = SchemaFactory.createForClass(ReferralEdge);

// ── Indexes ────────────────────────────────────────────────────────────────
// Per-tier downline list — `GET /referrals/me/list?tier=N` paginates by `_id`
// keyset under `{ inviterId, tier }`, so an indexed range scan with no in-memory
// sort. Suffix on `_id` mirrors the wallet's `userId,_id:-1` pattern.
ReferralEdgeSchema.index({ inviterId: 1, tier: 1, _id: -1 });

// Per-invitee read — the chain walker / first-purchase sweeper looks up "is
// this user already bound?" or "list every (T1, T2, T3) row for this purchaser"
// by inviteeId; an indexed lookup makes both O(1)/O(3).
ReferralEdgeSchema.index({ inviteeId: 1, tier: 1 });

// PRODUCT RULE: "one inviter per invitee, set at signup". A user can have at
// most one T1 edge (their direct inviter); the T2/T3 rows are mechanically
// derived from the T1 chain so they share the same inviteeId. We restrict the
// unique constraint to the T1 row via a partial filter so a SECOND bind by the
// same invitee triggers a clean E11000 the controller maps to 409 Conflict.
ReferralEdgeSchema.index(
  { inviteeId: 1 },
  { unique: true, partialFilterExpression: { tier: 1 } },
);
