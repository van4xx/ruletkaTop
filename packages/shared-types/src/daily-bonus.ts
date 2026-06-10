import { z } from 'zod';

import { isoDateSchema } from './common';

/**
 * The 7-day reward ladder — the single source of truth shared by the API
 * (credits at this rate, per `DailyBonusService.claim`) and the web widget
 * (renders these amounts under each rung). The week sums to EXACTLY 30 coins,
 * deliberately modest to keep daily-bonus economy linear with the rest of the
 * coin sinks.
 *
 * The cycle resets to 1 after Day 7 (the next claim credits `LADDER[0]` again),
 * and any skipped UTC day fully resets the streak.
 */
export const DAILY_BONUS_LADDER = [2, 3, 3, 4, 5, 6, 7] as const;

/** Length of the ladder (kept as a constant for both runtime + type math). */
export const DAILY_BONUS_LADDER_LENGTH = DAILY_BONUS_LADDER.length;

/** Numeric tuple type for the ladder (`readonly [2,3,3,4,5,6,7]`). */
export type DailyBonusLadder = typeof DAILY_BONUS_LADDER;

/**
 * The READ-state envelope returned by `GET /economy/daily-bonus` and echoed by
 * the claim endpoint (which also tacks on `justCredited`).
 *
 * - `streak`         — 0..7, where 0 means the user has never claimed.
 * - `claimedToday`   — true once today's claim has been credited.
 * - `canClaim`       — convenience inverse of `claimedToday` (server is the
 *   authority on the day boundary, so the client doesn't recompute UTC).
 * - `nextRewardCoins`— the amount that will be credited on the NEXT claim
 *   (looks ahead at the ladder taking into account the cycle reset / streak
 *   rollover).
 * - `nextResetAt`    — ISO timestamp of the next UTC midnight, so the UI can
 *   show a "вернись через Nч" countdown without trusting client clocks.
 * - `lifetimeCoins`  — running total of all coins credited through the bonus.
 */
export const dailyBonusStateSchema = z.object({
  streak: z.number().int().min(0).max(7),
  claimedToday: z.boolean(),
  canClaim: z.boolean(),
  nextRewardCoins: z.number().int().positive(),
  ladder: z
    .tuple([
      z.literal(DAILY_BONUS_LADDER[0]),
      z.literal(DAILY_BONUS_LADDER[1]),
      z.literal(DAILY_BONUS_LADDER[2]),
      z.literal(DAILY_BONUS_LADDER[3]),
      z.literal(DAILY_BONUS_LADDER[4]),
      z.literal(DAILY_BONUS_LADDER[5]),
      z.literal(DAILY_BONUS_LADDER[6]),
    ])
    .readonly(),
  nextResetAt: isoDateSchema,
  lifetimeCoins: z.number().int().nonnegative(),
});
export type DailyBonusState = z.infer<typeof dailyBonusStateSchema>;

/**
 * The claim-response envelope: the FULL state (so the client can apply it
 * in-place without a second GET) plus the amount JUST credited for the toast /
 * "+N" float-up animation over the rung.
 */
export const dailyBonusClaimResponseSchema = dailyBonusStateSchema.extend({
  justCredited: z.number().int().positive(),
});
export type DailyBonusClaimResponse = z.infer<typeof dailyBonusClaimResponseSchema>;
