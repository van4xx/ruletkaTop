'use client';

/**
 * Leaderboard data layer — now backed by the real aggregate endpoint
 * `GET /leaderboard?metric=<gifts|coins|top>&limit=`.
 *
 * The server computes the ranking on read from existing collections (gifts
 * received · coin balance · cumulative days in Top), returning ready-to-render
 * {@link LeaderboardEntry} rows (rank, nickname, avatar, isPremium, score) plus
 * the caller's own rank (`me`) when they fall outside the returned slice. No
 * client-side aggregation or per-user profile fan-out anymore.
 */
import { useQuery } from '@tanstack/react-query';
import type {
  LeaderboardEntry,
  LeaderboardMetric,
  LeaderboardResponse,
} from '@ruletka/shared-types';
import { api } from '@/lib/api';

/** How many ranked rows to request per board. */
const LEADERBOARD_LIMIT = 50;

export type { LeaderboardEntry, LeaderboardMetric } from '@ruletka/shared-types';

export interface UseLeaderboardResult {
  entries: LeaderboardEntry[];
  /** The caller's own rank, if they're not already in `entries`. */
  me: LeaderboardEntry | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/** Centralised query keys for the leaderboard (per metric). */
export const leaderboardKeys = {
  all: ['leaderboard'] as const,
  board: (metric: LeaderboardMetric) => [...leaderboardKeys.all, metric] as const,
};

export function useLeaderboard(metric: LeaderboardMetric): UseLeaderboardResult {
  const query = useQuery<LeaderboardResponse>({
    queryKey: leaderboardKeys.board(metric),
    queryFn: ({ signal }) => api.leaderboard.get({ metric, limit: LEADERBOARD_LIMIT }, signal),
    staleTime: 60_000,
  });

  return {
    entries: query.data?.entries ?? [],
    me: query.data?.me ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}
