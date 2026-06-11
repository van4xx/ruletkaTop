import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import type { AchievementTier } from '@ruletka/shared-types';

/**
 * Append-only unlock row: ONE row per `(userId, achievementId, tier)` triple.
 *
 * The unique compound index below is the IDEMPOTENCY KEY for the
 * `checkAndUnlock` flow — a duplicate insert (event re-fired, retried call,
 * concurrent path) hits the unique index and the service treats the
 * `E11000` as "already unlocked, no-op". The same triple is therefore
 * unlockable AT MOST ONCE, end-to-end, without any read-modify-write.
 *
 * Tiers Bronze/Silver/Gold each get their OWN row (so a user who reached
 * tier 3 has three rows: tier 1, 2, 3). This lets the public profile list
 * show "newest unlock first" naturally — the Gold row's `unlockedAt` is the
 * most recent moment the user crossed a tier on that achievement. The
 * service treats the SET of rows as the unlock history; the highest `tier`
 * for an `achievementId` is the user's current rank on that badge.
 *
 * Aliased from the catalogue's stable kebab-case ids (e.g. `first-call`,
 * `calls-10`) — NEVER an ObjectId reference, so a catalogue rename would be
 * a one-time migration script over this column.
 */
@Schema({ collection: 'userachievements', timestamps: { createdAt: true, updatedAt: false } })
export class UserAchievement {
  /** Owning account. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId!: Types.ObjectId;

  /** Catalogue id from `ACHIEVEMENTS_CATALOGUE`. Validated by the service. */
  @Prop({ required: true, type: String })
  achievementId!: string;

  /** Tier reached by THIS row (1 = Bronze, 2 = Silver, 3 = Gold). */
  @Prop({ required: true, type: Number, min: 1, max: 3 })
  tier!: AchievementTier;

  /** Server clock the unlock landed at; used for the public "newest" strip. */
  @Prop({ required: true, type: Date, default: (): Date => new Date() })
  unlockedAt!: Date;
}

export type UserAchievementDocument = HydratedDocument<UserAchievement>;

export const UserAchievementSchema = SchemaFactory.createForClass(UserAchievement);

// ── Indexes ────────────────────────────────────────────────────────────────
// IDEMPOTENCY: at most one row per (user, achievement, tier). The
// `checkAndUnlock` service writes blind and traps the duplicate-key error to
// turn a double-fire (retry, concurrent event) into a quiet no-op.
UserAchievementSchema.index(
  { userId: 1, achievementId: 1, tier: 1 },
  { unique: true, name: 'userachievements_user_ach_tier_uniq' },
);
// Per-user newest-first list (the public profile strip + the grid history).
// Picked over `(userId, _id)` because the public strip orders by the *unlock*
// instant, not by insertion order — these can drift by one tick on a back-fill.
UserAchievementSchema.index({ userId: 1, unlockedAt: -1 });
