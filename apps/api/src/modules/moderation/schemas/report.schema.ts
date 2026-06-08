import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import type { ReportReason, ReportStatus } from '@ruletka/shared-types';

const REPORT_REASONS: readonly ReportReason[] = [
  'nudity',
  'harassment',
  'minor',
  'violence',
  'spam',
  'scam',
  'other',
];

const REPORT_STATUSES: readonly ReportStatus[] = ['open', 'reviewing', 'resolved', 'dismissed'];

/**
 * A user-submitted abuse report against another user, optionally tied to the
 * match where the incident occurred. Moderators triage via the
 * `againstUserId + status` index (most-reported / still-open queues).
 */
@Schema({ collection: 'reports', timestamps: { createdAt: true, updatedAt: true } })
export class Report {
  /** Reporter. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  fromUserId!: Types.ObjectId;

  /** Reported user. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  againstUserId!: Types.ObjectId;

  /** Match context, if the report originated from a roulette session. */
  @Prop({ required: false, default: null, type: Types.ObjectId })
  matchId!: Types.ObjectId | null;

  @Prop({ required: true, enum: REPORT_REASONS, type: String })
  reason!: ReportReason;

  /** Free-text detail (≤1000 chars) or `null`. */
  @Prop({ required: false, default: null, type: String })
  details!: string | null;

  /**
   * Retained evidence frame (downscaled JPEG data-URL) captured from the live
   * call at report time, for moderator review, or `null` when none was supplied
   * (reports filed outside a call). Stored verbatim; named `evidenceUrl` so a
   * real deployment can offload the blob to object storage and keep only a URL
   * here without a contract/migration change — mirrors {@link ModerationEvent}.
   */
  @Prop({ required: false, default: null, type: String })
  evidenceUrl!: string | null;

  @Prop({ required: true, enum: REPORT_STATUSES, type: String, default: 'open' })
  status!: ReportStatus;

  // `createdAt` / `updatedAt` added by `timestamps`.
}

export type ReportDocument = HydratedDocument<Report>;

export const ReportSchema = SchemaFactory.createForClass(Report);

// ── Indexes (PROJECT_SPEC §6) ──────────────────────────────────────────────
// Moderation triage: reports against a user filtered by status.
ReportSchema.index({ againstUserId: 1, status: 1 });
// Recent-first global queue.
ReportSchema.index({ createdAt: -1 });
