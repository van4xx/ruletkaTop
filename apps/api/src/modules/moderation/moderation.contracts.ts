import { z } from 'zod';

/**
 * API-LOCAL runtime zod schemas for the moderator triage surface.
 *
 * There is no shared `@ruletka/shared-types` contract for these moderator-only
 * request shapes, so — following the `src/common/jwt-payload.schema.ts`
 * precedent — we declare the runtime validators here (kept structurally aligned
 * with the shared `reportStatus` / pagination enums). If the shared
 * `reportStatusSchema` gains/loses a member, update {@link resolveStatusSchema}.
 */

/** A moderator may only CLOSE a report as `resolved` or `dismissed`. */
export const resolveStatusSchema = z.enum(['resolved', 'dismissed']);

/** Body of `POST /reports/:id/resolve`. */
export const resolveReportSchema = z.object({
  status: resolveStatusSchema,
});
export type ResolveReportDto = z.infer<typeof resolveReportSchema>;

/**
 * Query of `GET /reports`: cursor pagination plus optional `status` and
 * `againstUserId` filters. `limit` is coerced from the query string and bounded,
 * mirroring the shared `paginationQuerySchema`. `againstUserId` lets an
 * investigator list every report filed AGAINST a given user (the reported
 * account); it is validated as a 24-char-hex ObjectId — structurally aligned
 * with the shared `objectIdSchema` (kept API-local for the reason in the file
 * header), so a malformed id is rejected at the pipe rather than the service.
 * Both filters compose, and `againstUserId + status` is index-backed on the
 * report schema.
 */
export const listReportsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']).optional(),
  againstUserId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid id')
    .optional(),
});
export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>;

/**
 * Query of `GET /moderation/review`: identical cursor-pagination + optional
 * `status` filter as the reports queue, over the AI-moderation review items.
 */
export const listReviewQuerySchema = listReportsQuerySchema;
export type ListReviewQuery = z.infer<typeof listReviewQuerySchema>;

/** Body of `POST /moderation/review/:id/resolve` — uphold or dismiss. */
export const resolveReviewSchema = z.object({
  status: resolveStatusSchema,
});
export type ResolveReviewDto = z.infer<typeof resolveReviewSchema>;

/**
 * Query of `GET /reports/open-counts`: how many most-reported users to return.
 * Coerced from the query string and bounded, mirroring the pagination `limit`.
 */
export const openReportsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type OpenReportsQuery = z.infer<typeof openReportsQuerySchema>;

/**
 * Query of `GET /moderation/appeals`: cursor pagination plus an optional appeal
 * `status` filter (mirrors {@link listReportsQuerySchema} but over the appeal
 * lifecycle enum). Kept API-local for the same reason as the report queries.
 */
export const listAppealsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'accepted', 'rejected']).optional(),
});
export type ListAppealsQuery = z.infer<typeof listAppealsQuerySchema>;

/** Body of `POST /moderation/appeals/:id/resolve` — accept (⇒ unban) or reject. */
export const resolveAppealSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
});
export type ResolveAppealDto = z.infer<typeof resolveAppealSchema>;

/**
 * Body of `POST /moderation/client-signal` — the lighter-weight on-device NSFW
 * signal stream the MOBILE client pushes during a call (separately from the
 * `/moderation/frame` evidence-bearing report path that the web client + the
 * mobile per-call screening loop already use).
 *
 * The body is intentionally lean — no evidence frame — so we can ingest it at
 * a much higher rate without bloating evidence storage. The aggregate is
 * `porn + hentai + sexy` from the on-device 5-class breakdown; the moderation
 * service feeds it through the same escalation path as a `/moderation/frame`
 * report (mapping the aggregate to `nudity`/`sexual` per the standard
 * thresholds — see `ModerationService.handleClientSignal`). Kept API-local
 * (not exported via `@ruletka/shared-types`) so the mobile client + the
 * server can iterate on the wire shape without forcing a shared-types rev.
 */
export const clientSignalSchema = z.object({
  /** Active match id, for correlation. Optional — between matches we accept null. */
  matchId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid matchId')
    .optional(),
  /** Combined `porn + hentai + sexy` score in [0,1]. */
  aggregate: z.number().min(0).max(1),
  /** Optional per-class breakdown — surfaces the dominant category server-side. */
  scores: z
    .object({
      drawings: z.number().min(0).max(1).optional(),
      hentai: z.number().min(0).max(1).optional(),
      neutral: z.number().min(0).max(1).optional(),
      porn: z.number().min(0).max(1).optional(),
      sexy: z.number().min(0).max(1).optional(),
    })
    .optional(),
});
export type ClientSignalDto = z.infer<typeof clientSignalSchema>;
