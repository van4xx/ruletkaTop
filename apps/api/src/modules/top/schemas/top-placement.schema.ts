import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import type { TopLane } from '@ruletka/shared-types';

/** Top-feed lanes (kept in sync with `topLaneSchema` in shared-types). */
const TOP_LANES: readonly TopLane[] = ['left', 'right'];

/**
 * A paid placement in one of the two "top" feed lanes for a bounded window.
 *
 * A user buys visibility by spending coins; `priority` (derived from coins
 * spent) ranks placements within a lane — higher first. A placement is "active"
 * while `now` is within `[startsAt, expiresAt)`. Expired rows are kept for
 * history/audit; the background expiry sweep flips {@link expired} on them past
 * their window so the Top feed (and any consumer) can cheaply skip dead rows.
 */
@Schema({ collection: 'topplacements', timestamps: true })
export class TopPlacement {
  /** The promoted account. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId!: Types.ObjectId;

  /** Which feed lane this placement occupies. */
  @Prop({ required: true, enum: TOP_LANES, type: String })
  lane!: TopLane;

  /** Ranking weight within the lane (higher shows first). Derived from spend. */
  @Prop({ required: true, default: 0, type: Number })
  priority!: number;

  /** Coins spent to buy this placement. */
  @Prop({ required: true, min: 0, type: Number })
  coinsSpent!: number;

  /** When the placement becomes active. */
  @Prop({ required: true, type: Date })
  startsAt!: Date;

  /** When the placement stops being active. */
  @Prop({ required: true, type: Date })
  expiresAt!: Date;

  /**
   * Set by the background expiry sweep once `expiresAt` has elapsed. Live reads
   * already exclude past-window rows via `expiresAt > now`, so this is NOT what
   * hides an expired placement from the feed — it is the sweep's idempotency
   * latch (a swept row is never re-processed) and an explicit audit marker that
   * the placement was reconciled to its terminal state.
   */
  @Prop({ required: true, default: false, type: Boolean })
  expired!: boolean;

  // `createdAt` / `updatedAt` added by `timestamps: true`.
}

export type TopPlacementDocument = HydratedDocument<TopPlacement>;

export const TopPlacementSchema = SchemaFactory.createForClass(TopPlacement);

// ── Indexes (PROJECT_SPEC §6) ──────────────────────────────────────────────
// Primary "active placements in a lane" query: filter by lane + expiry window,
// then sort by priority. Compound index covers the filter and aids the sort.
TopPlacementSchema.index({ lane: 1, expiresAt: 1, priority: -1 });
// Per-user placement history.
TopPlacementSchema.index({ userId: 1, expiresAt: -1 });
// Expiry sweep: find not-yet-reconciled placements whose window has elapsed.
TopPlacementSchema.index({ expired: 1, expiresAt: 1 });
