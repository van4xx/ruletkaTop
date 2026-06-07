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
 * Query of `GET /reports`: cursor pagination plus an optional `status` filter.
 * `limit` is coerced from the query string and bounded, mirroring the shared
 * `paginationQuerySchema`.
 */
export const listReportsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']).optional(),
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
