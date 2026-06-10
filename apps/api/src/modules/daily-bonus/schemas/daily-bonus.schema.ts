import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * Per-user daily-bonus row — tracks the streak through the 7-day ladder, the
 * UTC day of the most recent claim (so "already claimed today" is a cheap
 * string equality check), and lifetime aggregates used by the widget.
 *
 * Keyed 1:1 by `userId` (unique index below) and lazily upserted on the first
 * call from {@link DailyBonusService} — never seeded ahead of time.
 *
 * The wallet credit itself is recorded on the immutable ledger (CoinTransaction
 * with `type: 'bonus'`, `refId: daily-bonus:<userId>:<UTC-day>`); this row is
 * just the streak state machine and is fully reconstructible from the ledger.
 */
@Schema({ collection: 'dailybonuses', timestamps: true })
export class DailyBonus {
  /** Owning account. Unique — one row per user (index declared below). */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId!: Types.ObjectId;

  /**
   * Current streak position on the ladder, 0..7. 0 means the user has never
   * claimed yet; once they claim Day 7 the next claim starts a fresh cycle at 1.
   */
  @Prop({ required: true, default: 0, min: 0, max: 7, type: Number })
  streak!: number;

  /** Timestamp of the most recent successful claim (`null` until the first one). */
  @Prop({ required: false, default: null, type: Date })
  lastClaimedAt!: Date | null;

  /**
   * UTC day of the most recent claim as `YYYY-MM-DD`. Stored alongside the
   * timestamp so the "claimed today?" check is a cheap string equality with
   * `formatUtcDay(now)` and the "claimed yesterday?" check (for the grace
   * window) is the same — no client clock involved.
   */
  @Prop({ required: false, default: null, type: String })
  lastClaimDay!: string | null;

  /** Lifetime number of successful claims (never decremented). */
  @Prop({ required: true, default: 0, min: 0, type: Number })
  totalClaims!: number;

  /** Lifetime sum of coins credited via the daily bonus. */
  @Prop({ required: true, default: 0, min: 0, type: Number })
  totalCoins!: number;

  // `createdAt` / `updatedAt` added by `timestamps: true`.
}

export type DailyBonusDocument = HydratedDocument<DailyBonus>;

export const DailyBonusSchema = SchemaFactory.createForClass(DailyBonus);

// ── Indexes ────────────────────────────────────────────────────────────────
// One row per account; the primary lookup / atomic-upsert key.
DailyBonusSchema.index({ userId: 1 }, { unique: true });
