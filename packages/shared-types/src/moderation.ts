import { z } from 'zod';
import { isoDateSchema, objectIdSchema } from './common';

export const reportReasonSchema = z.enum([
  'nudity',
  'harassment',
  'minor',
  'violence',
  'spam',
  'scam',
  'other',
]);
export type ReportReason = z.infer<typeof reportReasonSchema>;

export const reportStatusSchema = z.enum(['open', 'reviewing', 'resolved', 'dismissed']);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

export const createReportSchema = z.object({
  againstUserId: objectIdSchema,
  matchId: objectIdSchema.optional(),
  reason: reportReasonSchema,
  details: z.string().max(1000).optional(),
});
export type CreateReportDto = z.infer<typeof createReportSchema>;

export const reportSchema = z.object({
  id: objectIdSchema,
  fromUserId: objectIdSchema,
  againstUserId: objectIdSchema,
  matchId: objectIdSchema.nullable(),
  reason: reportReasonSchema,
  details: z.string().nullable(),
  status: reportStatusSchema,
  createdAt: isoDateSchema,
});
export type Report = z.infer<typeof reportSchema>;

/**
 * Result of `POST /reports/:id/resolve-ban`: the now-`resolved` report plus the
 * applied ban (`isBanned` reflects the post-write state of the reported user).
 */
export const resolvedWithBanSchema = z.object({
  report: reportSchema,
  ban: z.object({ userId: objectIdSchema, isBanned: z.boolean() }),
});
export type ResolvedWithBan = z.infer<typeof resolvedWithBanSchema>;

/**
 * One row of the per-target open-report aggregate (`GET /reports/open-counts`):
 * a reported user and how many of their reports are still open/reviewing.
 * Powers the "most-complained-about users" moderation view.
 */
export const openReportCountSchema = z.object({
  againstUserId: objectIdSchema,
  openReports: z.number().int().nonnegative(),
});
export type OpenReportCount = z.infer<typeof openReportCountSchema>;

export const createBlockSchema = z.object({
  blockedUserId: objectIdSchema,
});
export type CreateBlockDto = z.infer<typeof createBlockSchema>;

export const blockSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  blockedUserId: objectIdSchema,
  createdAt: isoDateSchema,
});
export type Block = z.infer<typeof blockSchema>;

// ── Real-time AI moderation (live-video frame screening) ───────────────────
// Architecture: an on-device classifier samples the LOCAL video; on a likely
// violation the client (1) instantly blurs/cuts locally and (2) reports it here
// with a downscaled evidence frame. The server records it, applies an
// escalation policy (warn → kick → ban), and may force-disconnect the offender
// (`mod:action`). The server can also spot-check frames server-side. Labels and
// thresholds are deliberately conservative; `minor` (CSAM risk) is zero-tolerance.

export const moderationLabelSchema = z.enum([
  'nudity',
  'sexual',
  'violence',
  'minor',
  'safe',
  'other',
]);
export type ModerationLabel = z.infer<typeof moderationLabelSchema>;

/** Escalating enforcement action applied to an offender. */
export const moderationActionSchema = z.enum(['none', 'blur', 'warn', 'kick', 'ban']);
export type ModerationAction = z.infer<typeof moderationActionSchema>;

/** Client→server: a violation detected by on-device screening (with evidence). */
export const moderationViolationSchema = z.object({
  matchId: objectIdSchema.optional(),
  label: moderationLabelSchema,
  /** Classifier confidence in [0,1]. */
  score: z.number().min(0).max(1),
  /** Downscaled JPEG data-URL evidence frame, retained for human review. */
  evidence: z.string().max(2_000_000).optional(),
});
export type ModerationViolationDto = z.infer<typeof moderationViolationSchema>;

/** Server→client: a forced moderation action on the current session. */
export const moderationActionPayloadSchema = z.object({
  action: moderationActionSchema,
  label: moderationLabelSchema.optional(),
  reason: z.string().optional(),
  /** Unix epoch (seconds) the ban lifts, when `action='ban'` and temporary. */
  banExpiresAt: z.number().int().optional(),
});
export type ModerationActionPayload = z.infer<typeof moderationActionPayloadSchema>;

/** An admin review-queue item — a flagged event awaiting a human decision. */
export const reviewItemSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  matchId: objectIdSchema.nullable(),
  label: moderationLabelSchema,
  score: z.number(),
  /** URL/ref of the retained evidence frame (null once purged). */
  evidenceUrl: z.string().nullable(),
  /** The action the auto-policy already took (before human review). */
  autoAction: moderationActionSchema,
  status: reportStatusSchema,
  createdAt: isoDateSchema,
});
export type ReviewItem = z.infer<typeof reviewItemSchema>;

/**
 * Result of `POST /moderation/review/:id/resolve-ban`: the now-`resolved`
 * review item plus the ban applied to the flagged user (`isBanned` reflects the
 * post-write state). Lets a moderator confirm an AI-flagged violation AND
 * sanction the offender in one action.
 */
export const resolvedReviewWithBanSchema = z.object({
  item: reviewItemSchema,
  ban: z.object({ userId: objectIdSchema, isBanned: z.boolean() }),
});
export type ResolvedReviewWithBan = z.infer<typeof resolvedReviewWithBanSchema>;
