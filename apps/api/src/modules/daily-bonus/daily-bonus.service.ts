import { ConflictException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  DAILY_BONUS_LADDER,
  DAILY_BONUS_TIER_MULTIPLIER,
  multipliedDailyBonus,
  type DailyBonusClaimResponse,
  type DailyBonusState,
  type EffectiveTier,
} from '@ruletka/shared-types';

import { PremiumService } from '../premium/premium.service';
import { WalletService } from '../wallet/wallet.service';
import { DailyBonus, DailyBonusDocument } from './schemas/daily-bonus.schema';

/**
 * Injection token for the "current time" provider. Defaults to `() => new Date()`
 * but specs override it so the day-boundary logic (claim/skip/reset) can be
 * exercised deterministically without monkey-patching globals.
 */
export const DAILY_BONUS_CLOCK = Symbol('DAILY_BONUS_CLOCK');
export type DailyBonusClock = () => Date;

/**
 * Format a Date as a UTC `YYYY-MM-DD` day key.
 *
 * Stored on {@link DailyBonus.lastClaimDay} so the "claimed today?" /
 * "claimed yesterday?" checks are cheap string comparisons against the UTC day
 * derived from the server's authoritative clock — no client clock involved, no
 * timezone math, no DST edge cases (UTC has neither).
 */
export function formatUtcDay(date: Date): string {
  // toISOString() is always `YYYY-MM-DDTHH:mm:ss.sssZ`; slice the date portion.
  return date.toISOString().slice(0, 10);
}

/** Subtract one calendar day in UTC and return the resulting `YYYY-MM-DD` key. */
export function previousUtcDay(today: Date): string {
  const yesterday = new Date(today.getTime());
  // Setting UTC-date by `-1` correctly rolls into the previous month/year.
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return formatUtcDay(yesterday);
}

/** ISO timestamp of the next UTC midnight after `now`. */
export function nextUtcMidnight(now: Date): Date {
  const next = new Date(now.getTime());
  // Move to 00:00:00.000 UTC of the next day.
  next.setUTCHours(24, 0, 0, 0);
  return next;
}

/**
 * Streak-aware daily-bonus state machine + claim flow.
 *
 * The ladder is the {@link DAILY_BONUS_LADDER} constant (7 coins on day 7, 30
 * total per cycle). The cycle resets to 1 after day 7 OR after any skipped day.
 *
 * IDEMPOTENCY: a claim namespaces the wallet ledger refId as
 * `daily-bonus:<userId>:<UTC-day>`. A duplicated request hits the wallet's
 * partial-unique `(type, refId)` index and the wallet handles the duplicate
 * cleanly — but we also short-circuit BEFORE that with a cheap 409 on
 * `row.lastClaimDay === today`, so the user gets a fast "already claimed today"
 * without a wallet write.
 *
 * Defensive ladder invariant: the spec hard-requires the week sum to be
 * exactly 30. We assert it at construction so any future tweak that breaks the
 * contract fails loudly at boot rather than silently shifting the economy.
 */
@Injectable()
export class DailyBonusService {
  private readonly logger = new Logger(DailyBonusService.name);
  private readonly clock: DailyBonusClock;

  constructor(
    @InjectModel(DailyBonus.name) private readonly dailyBonusModel: Model<DailyBonusDocument>,
    private readonly walletService: WalletService,
    private readonly premiumService: PremiumService,
    @Optional() @Inject(DAILY_BONUS_CLOCK) clock?: DailyBonusClock,
  ) {
    this.clock = clock ?? (() => new Date());
    // Hard product invariant: the week MUST sum to 30 (see DAILY_BONUS_LADDER
    // docstring). Asserting here catches a tampered constant at boot rather
    // than after the bonus has under/over-credited a million users.
    const sum = DAILY_BONUS_LADDER.reduce((acc, n) => acc + n, 0);
    if (sum !== 30) {
      throw new Error(
        `DAILY_BONUS_LADDER MUST sum to 30 coins/week (got ${sum}). ` +
          'Refusing to boot the daily-bonus service with a tampered ladder.',
      );
    }
  }

  /**
   * Read the caller's daily-bonus state for the widget. Lazily upserts a
   * zero-streak row for first-time callers so the state is always materialized
   * (and the subsequent claim is a guaranteed `findOneAndUpdate` hit, not a
   * second upsert race).
   */
  async getState(userId: string): Promise<DailyBonusState> {
    const _id = new Types.ObjectId(userId);
    const row = await this.dailyBonusModel
      .findOneAndUpdate(
        { userId: _id },
        { $setOnInsert: { userId: _id, streak: 0, totalClaims: 0, totalCoins: 0 } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
    // Read the caller's effective tier so the widget's `nextRewardCoins`
    // already reflects the post-multiplier amount the next claim WILL credit
    // (Lite=1.5x, Pro=2x). The web widget shows it verbatim — no client-side
    // multiplier math needed.
    const tier = await this.premiumService.getEffectiveTier(userId);
    return this.toState(row, tier);
  }

  /**
   * Atomically credit today's bonus and advance the streak.
   *
   *  1. Load/upsert the row (always returns the live document).
   *  2. If `row.lastClaimDay === today` → 409 (no wallet write — fast path).
   *  3. Compute the new streak: `lastClaimDay === yesterday` continues the
   *     cycle (`(streak % 7) + 1`); ANY other day (gap, skipped day, first ever
   *     claim) resets to 1. STRICT — there is no grace window.
   *  4. Credit `LADDER[newStreak - 1]` via WalletService.credit with a
   *     namespaced, day-keyed refId — the IDEMPOTENCY KEY backing both the
   *     ledger's `(type, refId)` index and a retried claim hitting it as a
   *     duplicate (the wallet skips the duplicate row cleanly).
   *  5. Persist the row (streak, lastClaimDay, lastClaimedAt, lifetime totals).
   *  6. Return the post-claim state + `justCredited` for the UI animation.
   */
  async claim(userId: string): Promise<DailyBonusClaimResponse> {
    const _id = new Types.ObjectId(userId);
    const now = this.clock();
    const today = formatUtcDay(now);

    // Step 1: load/upsert the row. We do this BEFORE the wallet credit so the
    // "already claimed today" short-circuit (step 2) doesn't waste a wallet
    // round-trip on a retried/double-tapped claim.
    const row = await this.dailyBonusModel
      .findOneAndUpdate(
        { userId: _id },
        { $setOnInsert: { userId: _id, streak: 0, totalClaims: 0, totalCoins: 0 } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();

    // Step 2: idempotent short-circuit — already claimed today.
    if (row.lastClaimDay === today) {
      throw new ConflictException('Already claimed today');
    }

    // Step 3: STRICT yesterday-or-reset. The grace window is exactly one UTC
    // day — anything older fully resets the cycle to streak=1.
    const yesterday = previousUtcDay(now);
    const continuing = row.lastClaimDay === yesterday;
    // `(streak % 7) + 1` rolls 7 → 1 so the next claim after a completed week
    // starts a fresh cycle at the ladder's first rung (per the product spec).
    const newStreak = continuing ? (row.streak % 7) + 1 : 1;
    const baseCoins = DAILY_BONUS_LADDER[newStreak - 1]!;

    // Read the caller's effective premium tier at credit time so a freshly
    // bought (or just-expired) Pro subscription takes effect on the very next
    // claim. {@link multipliedDailyBonus} integer-floors the result so the
    // wallet's `assertPositiveInt` accepts it — Free 1x, Lite 1.5x, Pro 2x.
    const tier = await this.premiumService.getEffectiveTier(userId);
    const coinsToCredit = multipliedDailyBonus(baseCoins, tier);

    // Step 4: credit via WalletService. The refId is the IDEMPOTENCY KEY: a
    // duplicated claim (network retry, double-click) lands on the wallet's
    // partial-unique (type, refId) ledger index and is skipped cleanly. We
    // namespace by user AND UTC day so the next day's claim has a different
    // refId and is not blocked by today's row. The tier IS NOT in the refId
    // so a same-day claim under a flipped tier still hits the same idempotency
    // row (a user can't double-dip by upgrading mid-day).
    const refId = `daily-bonus:${userId}:${today}`;
    await this.walletService.credit(userId, coinsToCredit, 'bonus', refId);

    // Step 5: persist the new streak / day / lifetime aggregates.
    row.streak = newStreak;
    row.lastClaimDay = today;
    row.lastClaimedAt = now;
    row.totalClaims += 1;
    row.totalCoins += coinsToCredit;
    await row.save();

    // Step 6: return the fresh state + the just-credited amount.
    const state = this.toState(row, tier);
    return { ...state, justCredited: coinsToCredit };
  }

  /**
   * Map a hydrated row + the current clock to the public state envelope.
   *
   * `canClaim`/`claimedToday` are derived from the UTC day boundary on the
   * server's authoritative clock — the client never recomputes it. The
   * `nextRewardCoins` peek mirrors the same `continuing ? (s % 7) + 1 : 1`
   * arithmetic the claim flow uses, so the button shows the actual amount the
   * next claim will credit.
   */
  private toState(row: DailyBonusDocument, tier: EffectiveTier = 'none'): DailyBonusState {
    const now = this.clock();
    const today = formatUtcDay(now);
    const yesterday = previousUtcDay(now);
    const claimedToday = row.lastClaimDay === today;
    const canClaim = !claimedToday;

    // Peek at the rung the NEXT claim will land on. When the user can still
    // claim today AND yesterday's streak continues, the next claim continues
    // the cycle; an idle/dead streak resets to 1; once they've claimed today,
    // the "next" claim is tomorrow's — same rule against TODAY's streak.
    const continuingForNext = claimedToday
      ? true
      : row.lastClaimDay === yesterday && row.streak > 0;
    const baseStreak = claimedToday ? row.streak : row.streak;
    const nextStreak = continuingForNext ? (baseStreak % 7) + 1 : 1;
    const baseNextReward = DAILY_BONUS_LADDER[nextStreak - 1]!;
    // Apply the same tier multiplier the next CLAIM will apply, so the widget
    // shows the exact post-multiplier amount. Defaults to `'none'` (1x) when
    // the caller didn't pass a tier — preserves the pre-split behaviour for
    // any direct internal call site.
    const nextRewardCoins = multipliedDailyBonus(baseNextReward, tier);

    return {
      streak: row.streak,
      claimedToday,
      canClaim,
      nextRewardCoins,
      ladder: DAILY_BONUS_LADDER,
      nextResetAt: nextUtcMidnight(now).toISOString(),
      lifetimeCoins: row.totalCoins,
    };
  }
}

/** Re-export for tests / call sites that want to label the multiplier in copy. */
export { DAILY_BONUS_TIER_MULTIPLIER };
