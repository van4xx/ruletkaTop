'use client';

/**
 * Admin review-queue data hooks.
 *
 *  - {@link useReviewQueue}    — GET /moderation/review (optionally by status).
 *  - {@link useResolveReview}  — POST /moderation/review/:id/resolve, with an
 *    optimistic removal of the resolved item from every cached queue list and a
 *    rollback on failure.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { ReportStatus, ReviewItem } from '@ruletka/shared-types';
import { ApiClientError } from '@/lib/api';
import { moderationApi, moderationKeys, type ReviewResolution } from './api';

/** Cached queue lists touched by an optimistic resolve, for rollback. */
type ResolveContext = { snapshots: Array<[readonly unknown[], ReviewItem[] | undefined]> };

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
    onMutate: async ({ id }) => {
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
    onError: (_err, _vars, context) => {
      // Restore every list we touched.
      context?.snapshots.forEach(([key, list]) => {
        queryClient.setQueryData(key, list);
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: moderationKeys.all });
    },
  });
}
