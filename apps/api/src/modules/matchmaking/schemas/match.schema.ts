import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import type { MatchEndReason, MatchType } from '@ruletka/shared-types';

/**
 * Snapshot of the matchmaking filters that were in effect for one side when a
 * match was created. Persisted verbatim so analytics can reconstruct *why* a
 * given pairing happened even after the user later changes their preferences.
 *
 * Kept as a free-form sub-document (no own `_id`) — it mirrors
 * `matchFiltersSchema` from the shared contract but is stored, not validated,
 * here.
 */
@Schema({ _id: false })
export class MatchFiltersSnapshot {
  @Prop({ type: String, required: true })
  gender!: string;

  @Prop({ type: Number, required: true })
  ageMin!: number;

  @Prop({ type: Number, required: true })
  ageMax!: number;

  @Prop({ type: [String], default: [] })
  countries!: string[];
}

export const MatchFiltersSnapshotSchema = SchemaFactory.createForClass(MatchFiltersSnapshot);

export type MatchDocument = HydratedDocument<Match>;

/**
 * Persistent log of every roulette pairing. One row is written the instant two
 * users are matched ({@link MatchService.createMatch}); `endedAt` / `endReason`
 * are filled in when the room is torn down ({@link MatchService.endMatch}).
 *
 * This collection is analytics-oriented (session counts, churn reasons, match
 * durations, popular filter combinations) — it is NOT used as live room state
 * (that lives in Redis on the gateway).
 */
@Schema({ collection: 'matches', timestamps: false })
export class Match {
  /** First participant (the one already waiting when the pair was formed). */
  @Prop({ type: String, required: true, index: true })
  userA!: string;

  /** Second participant (the joiner who triggered the match). */
  @Prop({ type: String, required: true, index: true })
  userB!: string;

  /** Media modality of the session. */
  @Prop({ type: String, required: true, enum: ['video', 'voice'] })
  type!: MatchType;

  /** When the pairing was created (server clock). */
  @Prop({ type: Date, required: true, default: (): Date => new Date(), index: true })
  startedAt!: Date;

  /** When the session ended; `null` while the call is still live. */
  @Prop({ type: Date, default: null })
  endedAt!: Date | null;

  /** Why the session ended; `null` while still live. */
  @Prop({
    type: String,
    default: null,
    enum: ['next', 'stop', 'disconnect', 'timeout', 'reported', null],
  })
  endReason!: MatchEndReason | null;

  /**
   * The joiner's ({@link userB}) filter snapshot at match time. We store one
   * side's filters as the canonical snapshot for the row (matches the spec's
   * single `filtersSnapshot`); the matcher already enforced mutual
   * compatibility before the row was written.
   */
  @Prop({ type: MatchFiltersSnapshotSchema, required: true })
  filtersSnapshot!: MatchFiltersSnapshot;
}

export const MatchSchema = SchemaFactory.createForClass(Match);

// ── Analytics indexes ──────────────────────────────────────────────────────
// Per-user history (either side), newest first — powers "my recent matches".
MatchSchema.index({ userA: 1, startedAt: -1 });
MatchSchema.index({ userB: 1, startedAt: -1 });
// Time-bucketed analytics over modality (DAU by type, durations, churn).
MatchSchema.index({ type: 1, startedAt: -1 });
// Fast lookup of still-live sessions (e.g. reconciliation / cleanup sweeps).
MatchSchema.index({ endedAt: 1 });
