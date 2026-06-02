import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import type { ModerationAction, ModerationLabel, ReportStatus } from '@ruletka/shared-types';

/** Classifier labels persisted on an event (mirrors `moderationLabelSchema`). */
const MODERATION_LABELS: readonly ModerationLabel[] = [
  'nudity',
  'sexual',
  'violence',
  'minor',
  'safe',
  'other',
];

/** Auto-actions persisted on an event (mirrors `moderationActionSchema`). */
const MODERATION_ACTIONS: readonly ModerationAction[] = [
  'none',
  'blur',
  'warn',
  'kick',
  'ban',
];

/**
 * Review statuses reuse the shared `reportStatusSchema` enum so the admin queue
 * is consistent with the abuse-report triage surface.
 */
const REVIEW_STATUSES: readonly ReportStatus[] = [
  'open',
  'reviewing',
  'resolved',
  'dismissed',
];

/**
 * A single AI-moderation event: one frame flagged by on-device (or server-side)
 * screening against `userId`, the auto-action the escalation policy took, the
 * retained evidence frame and its human-review status.
 *
 * This collection is BOTH the audit log of every violation AND the admin review
 * queue (`status` filters the queue; `open` items await a human decision). For
 * `minor` (CSAM-risk) events evidence is retained and the row is flagged for
 * review regardless of score — see {@link ModerationService}.
 */
@Schema({ collection: 'moderation_events', timestamps: { createdAt: true, updatedAt: true } })
export class ModerationEvent {
  /** The offending user the event was filed against. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId!: Types.ObjectId;

  /** Match/room context, if the frame came from a roulette session. */
  @Prop({ required: false, default: null, type: Types.ObjectId })
  matchId!: Types.ObjectId | null;

  /** Classifier label for the flagged frame. */
  @Prop({ required: true, enum: MODERATION_LABELS, type: String })
  label!: ModerationLabel;

  /** Classifier confidence in [0,1]. */
  @Prop({ required: true, type: Number, min: 0, max: 1 })
  score!: number;

  /**
   * Retained evidence frame (downscaled JPEG data-URL) for human review, or
   * `null` once purged / never supplied. Stored verbatim; a real deployment
   * would offload this to object storage and keep only a URL here — the
   * contract field is named `evidenceUrl` to allow that without a migration.
   */
  @Prop({ required: false, default: null, type: String })
  evidenceUrl!: string | null;

  /** The action the auto-escalation policy applied at ingest time. */
  @Prop({ required: true, enum: MODERATION_ACTIONS, type: String })
  autoAction!: ModerationAction;

  /** Human-review status; `open` until a moderator upholds/dismisses it. */
  @Prop({ required: true, enum: REVIEW_STATUSES, type: String, default: 'open' })
  status!: ReportStatus;

  // `createdAt` / `updatedAt` added by `timestamps`.
}

export type ModerationEventDocument = HydratedDocument<ModerationEvent>;

export const ModerationEventSchema = SchemaFactory.createForClass(ModerationEvent);

// ── Indexes ────────────────────────────────────────────────────────────────
// Escalation policy counts a user's recent violations: (userId, createdAt).
ModerationEventSchema.index({ userId: 1, createdAt: -1 });
// Admin review queue: open/flagged items, newest first (status + _id paginates).
ModerationEventSchema.index({ status: 1, _id: -1 });
