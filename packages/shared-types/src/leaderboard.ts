import { z } from 'zod';
import { objectIdSchema } from './common';

/**
 * Leaderboard contract. Ranks users by a derivable metric (no new tracking
 * needed): total value of gifts RECEIVED, current coin balance, or cumulative
 * days held in the Top feed. Computed on read from existing collections.
 */
export const leaderboardMetricSchema = z.enum(['gifts', 'coins', 'top']);
export type LeaderboardMetric = z.infer<typeof leaderboardMetricSchema>;

export const leaderboardEntrySchema = z.object({
  /** 1-based position. */
  rank: z.number().int().positive(),
  userId: objectIdSchema,
  nickname: z.string(),
  avatarUrl: z.string().nullable(),
  isPremium: z.boolean(),
  /** Metric-specific score (received-gift coin value · coin balance · days in Top). */
  score: z.number().nonnegative(),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

export const leaderboardQuerySchema = z.object({
  metric: leaderboardMetricSchema.default('gifts'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

export const leaderboardResponseSchema = z.object({
  metric: leaderboardMetricSchema,
  entries: z.array(leaderboardEntrySchema),
  /** The caller's own rank, if they're not already in the returned slice. */
  me: leaderboardEntrySchema.nullable().optional(),
});
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;
