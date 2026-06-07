'use client';

/**
 * Admin review-queue data hooks.
 *
 *  - {@link useReviewQueue}          — GET /moderation/review (optionally by status).
 *  - {@link useResolveReview}        — POST /moderation/review/:id/resolve, with an
 *    optimistic removal of the resolved item from every cached queue list and a
 *    rollback on failure.
 *  - {@link useResolveReviewAndBan}  — POST /moderation/review/:id/resolve-ban
 *    (uphold + ban the flagged user), with the same optimistic removal/rollback.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { ReportStatus, ResolvedReviewWithBan, ReviewItem } from '@ruletka/shared-types';
import { ApiClientError } from '@/lib/api';
import { moderationApi, moderationKeys, type ReviewResolution } from './api';

/** Cached queue lists touched by an optimistic resolve, for rollback. */
type ResolveContext = { snapshots: Array<[readonly unknown[], ReviewItem[] | undefined]> };

/** Wraps a value into `{ id: ... }` so both resolve hooks share one removal helper. */
type IdVars = { id: string };

/** The review queue (defaults to open items awaiting a decision). */
export function useReviewQueue(
  status: ReportStatus = 'open',
): UseQueryResult<ReviewItem[], ApiClientError> {
  return useQuery<ReviewItem[], ApiClientError>({
    queryKey: moderationKeys.review(status),
    queryFn: () => moderationApi.review(status),
    // Moderation is time-sensitive; keep it reasonably fresh but not chatty.
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export interface ResolveVars {
  id: string;
  resolution: ReviewResolution;
}

/**
 * Resolve a flagged item. Optimistically drops it from all cached queue lists
 * so the UI feels instant; rolls back if the request fails.
 */
export function useResolveReview() {
  const queryClient = useQueryClient();

  return useMutation<void, ApiClientError, ResolveVars, ResolveContext>({
    mutationFn: ({ id, resolution }) => moderationApi.resolve(id, resolution),
    ...optimisticRemovalCallbacks(queryClient),
  });
}

/**
 * Uphold a flagged item AND ban the offending user (one moderator action). Same
 * optimistic removal/rollback as {@link useResolveReview} — the item leaves the
 * open queue the instant the action fires, and is restored if the request fails.
 */
export function useResolveReviewAndBan() {
  const queryClient = useQueryClient();

  return useMutation<ResolvedReviewWithBan, ApiClientError, IdVars, ResolveContext>({
    mutationFn: ({ id }) => moderationApi.resolveAndBan(id),
    ...optimisticRemovalCallbacks(queryClient),
  });
}

/**
 * Shared `onMutate`/`onError`/`onSettled` for the resolve mutations: optimistically
 * drop the item (by `id`) from every cached queue list, snapshot for rollback,
 * restore on error and invalidate on settle. Generic over any `{ id }` variables
 * so both the plain-resolve and resolve-with-ban hooks reuse it verbatim.
 */
function optimisticRemovalCallbacks<TData, TVars extends IdVars>(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  return {
    onMutate: async ({ id }: TVars): Promise<ResolveContext> => {
      await queryClient.cancelQueries({ queryKey: moderationKeys.all });
      const snapshots = queryClient.getQueriesData<ReviewItem[]>({
        queryKey: moderationKeys.all,
      });
      for (const [key, list] of snapshots) {
        if (list) {
          queryClient.setQueryData<ReviewItem[]>(
            key,
            list.filter((item) => item.id !== id),
          );
        }
      }
      return { snapshots };
    },
    onError: (_err: ApiClientError, _vars: TVars, context: ResolveContext | undefined) => {
      // Restore every list we touched.
      context?.snapshots.forEach(([key, list]) => {
        queryClient.setQueryData(key, list);
      });
    },
    onSettled: (
      _data: TData | undefined,
      _err: ApiClientError | null,
      _vars: TVars,
      _context: ResolveContext | undefined,
    ) => {
      void queryClient.invalidateQueries({ queryKey: moderationKeys.all });
    },
  };
}
