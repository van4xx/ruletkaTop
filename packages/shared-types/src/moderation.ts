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
  /**
   * Optional evidence frame (downscaled JPEG data-URL) captured from the live
   * call at report time, retained for moderator review. ADDITIVE + optional so
   * existing callers (e.g. reports filed outside a call) still type-check; bound
   * to the same ~2MB ceiling as the AI-moderation evidence frame.
   */
  evidence: z.string().max(2_000_000).optional(),
});
export type CreateReportDto = z.infer<typeof createReportSchema>;

export const reportSchema = z.object({
  id: objectIdSchema,
  fromUserId: objectIdSchema,
  againstUserId: objectIdSchema,
  matchId: objectIdSchema.nullable(),
  reason: reportReasonSchema,
  details: z.string().nullable(),
  /** Retained evidence frame (data-URL) captured at report time, or null. */
  evidenceUrl: z.string().nullable(),
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

/**
 * A block enriched with the blocked user's MINIMAL public identity (nickname +
 * avatar), so the blocklist UI is readable instead of showing a raw hex id. The
 * profile join is best-effort: a deleted/absent profile leaves `nickname` empty
 * and `avatarUrl` null, but the block row itself is always present. Additive
 * superset of {@link Block} — any consumer of the bare block fields still works.
 */
export const blockedUserSchema = blockSchema.extend({
  /** The blocked user's display nickname (empty string if the profile is gone). */
  nickname: z.string(),
  /** The blocked user's avatar URL, or `null` when unset / profile missing. */
  avatarUrl: z.string().nullable(),
});
export type BlockedUser = z.infer<typeof blockedUserSchema>;

// ── Ban appeals (a banned user contests their ban) ─────────────────────────
// A banned account cannot authenticate (login is rejected), so an appeal is an
// UNAUTHENTICATED credential-verified request: the user re-proves identity with
// their email + password and writes a single pending appeal a moderator can then
// accept (⇒ unban) or reject. The login rejection itself now carries the
// `banReason` so the client can explain WHY the account is blocked and offer the
// appeal flow.

export const appealStatusSchema = z.enum(['pending', 'accepted', 'rejected']);
export type AppealStatus = z.infer<typeof appealStatusSchema>;

/**
 * Submit a ban appeal. Credential-verified rather than token-authenticated
 * because the appellant is banned (and thus cannot hold an access token): the
 * `email` + `password` re-prove identity, and `message` states the case.
 */
export const createAppealSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  /** The user's case for why the ban should be lifted. */
  message: z.string().min(10).max(2000),
});
export type CreateAppealDto = z.infer<typeof createAppealSchema>;

/**
 * A submitted appeal as surfaced to the moderation console. `banReason` echoes
 * the reason captured at ban time (context for the reviewer); `resolvedAt` /
 * `decidedBy` are set once a moderator accepts or rejects it.
 */
export const appealSchema = z.object({
  id: objectIdSchema,
  /** The banned account that filed the appeal. */
  userId: objectIdSchema,
  /** Denormalised at submit time so the queue reads without a user join. */
  email: z.string(),
  nickname: z.string(),
  /** The reason the account was banned, echoed for reviewer context (or null). */
  banReason: z.string().nullable(),
  message: z.string(),
  status: appealStatusSchema,
  createdAt: isoDateSchema,
  /** When a moderator decided the appeal, or null while still pending. */
  resolvedAt: isoDateSchema.nullable(),
  /** Moderator/admin user id that decided the appeal, or null while pending. */
  decidedBy: objectIdSchema.nullable(),
});
export type Appeal = z.infer<typeof appealSchema>;

/**
 * Result of `POST /moderation/appeals/:id/resolve`: the decided appeal plus, when
 * accepted, the resulting unban (`isBanned` reflects the post-write state). A
 * rejection leaves the account banned, so `ban.isBanned` stays `true`.
 */
export const resolvedAppealSchema = z.object({
  appeal: appealSchema,
  ban: z.object({ userId: objectIdSchema, isBanned: z.boolean() }),
});
export type ResolvedAppeal = z.infer<typeof resolvedAppealSchema>;

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
