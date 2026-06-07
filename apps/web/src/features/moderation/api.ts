'use client';

/**
 * Moderation REST surface (thin wrappers over the shared `api.request` escape
 * hatch — these endpoints aren't modelled on the typed `api` object yet).
 *
 *  - POST /moderation/frame          — client→server violation report (evidence)
 *  - GET  /moderation/review         — admin review queue
 *  - POST /moderation/review/:id/resolve — admin uphold/dismiss a flagged item
 *
 * Request/response shapes come straight from the `@ruletka/shared-types`
 * contract so the wire format stays in lockstep with the backend.
 */
import type {
  ModerationViolationDto,
  ReportStatus,
  ResolvedReviewWithBan,
  ReviewItem,
} from '@ruletka/shared-types';
import { api } from '@/lib/api';

/** A human review decision. `uphold` confirms the violation; `dismiss` clears it. */
export type ReviewResolution = 'uphold' | 'dismiss';

export const moderationApi = {
  /**
   * Report a locally-detected violation with a downscaled evidence frame.
   * Fire-and-forget from the caller's perspective (best-effort, non-idempotent),
   * so we opt out of automatic retries to avoid duplicate evidence rows.
   */
  reportFrame: (dto: ModerationViolationDto): Promise<void> =>
    api.request<void>('/moderation/frame', {
      method: 'POST',
      json: dto,
      noRetry: true,
    }),

  /**
   * Fetch the admin review queue, optionally filtered by status. The backend
   * returns a cursor-paginated envelope (`{ items, nextCursor, hasMore }`); we
   * unwrap to the item array for the queue UI (tolerating a bare array too).
   */
  review: async (status?: ReportStatus): Promise<ReviewItem[]> => {
    const res = await api.request<{ items: ReviewItem[] } | ReviewItem[]>('/moderation/review', {
      query: status ? { status } : undefined,
    });
    return Array.isArray(res) ? res : (res?.items ?? []);
  },

  /**
   * Resolve a queued item. The UX speaks `uphold`/`dismiss`; the contract's
   * `POST /moderation/review/:id/resolve` expects `{ status: 'resolved' |
   * 'dismissed' }` (uphold ⇒ resolved, dismiss ⇒ dismissed).
   */
  resolve: (id: string, resolution: ReviewResolution): Promise<void> =>
    api.request<void>(`/moderation/review/${id}/resolve`, {
      method: 'POST',
      json: { status: resolution === 'uphold' ? 'resolved' : 'dismissed' },
      noRetry: true,
    }),

  /**
   * Uphold a queued item AND ban the flagged user in one moderator action
   * (`POST /moderation/review/:id/resolve-ban`). The server resolves the item
   * and applies a real ban (flips `isBanned`, revokes sessions, force-disconnects
   * the offender). Non-idempotent (it mutates ban state), so we opt out of retries.
   */
  resolveAndBan: (id: string): Promise<ResolvedReviewWithBan> =>
    api.request<ResolvedReviewWithBan>(`/moderation/review/${id}/resolve-ban`, {
      method: 'POST',
      noRetry: true,
    }),
} as const;

/** TanStack Query keys for the moderation review queue. */
export const moderationKeys = {
  all: ['moderation'] as const,
  review: (status?: ReportStatus) => ['moderation', 'review', status ?? 'all'] as const,
};
