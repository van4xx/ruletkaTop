import { z } from 'zod';

import { isoDateSchema, objectIdSchema } from './common';

/**
 * Achievement / badge catalogue + I/O contracts shared by the API and the web.
 *
 * The CATALOGUE is the single source of truth: a flat, exhaustive `Achievement`
 * list keyed by stable `id` (kebab-case). Both sides import the SAME array, so
 * the API never invents an unknown id and the web never displays an unknown
 * one. To add a new badge: append one row here and one ledger row under each
 * locale section in `apps/web/messages/{ru,en}/profile.json` (the `title` /
 * `description` fields below are LOCALIZATION KEY suffixes, not display copy).
 *
 * The contract is intentionally minimal — the heavy `checkAndUnlock` decision
 * table lives in `apps/api/src/modules/achievements/achievements.service.ts`
 * where it can read the existing counters cheaply.
 *
 * ── Tiering ────────────────────────────────────────────────────────────────
 * Most multi-step badges (e.g. `calls10` → 10, 100, 500) use a single `id`
 * with THREE tiers (Bronze/Silver/Gold = 1/2/3). The unlock row stores the
 * highest tier the user has reached; the service is idempotent on the
 * `(userId, achievementId, tier)` tuple. Some single-step badges (`firstCall`,
 * `nightOwl`, `earlyBird`, `dailyBonus7`, …) ship as a SINGLE tier — the
 * `tiers` array on the catalogue entry has exactly one element. The unlock
 * envelope still carries `tier: 1` for those so the wire shape is uniform.
 */

// ── Enums ──────────────────────────────────────────────────────────────────

/**
 * Top-level grouping shown as tabs in the achievements grid.
 *
 * EXPORTED for the catalogue + the grid filter — keep in sync with the i18n
 * `achievements.categories.<category>` key in `profile.json`.
 */
export const achievementCategorySchema = z.enum([
  'time',
  'conversation',
  'friends',
  'economy',
  'leaderboard',
  'social',
  'streak',
  'hidden',
]);
export type AchievementCategory = z.infer<typeof achievementCategorySchema>;

/**
 * Tier of a single unlock. Tier 1 is Bronze, 2 is Silver, 3 is Gold. The web
 * derives a glow color from this number; the unlock storage stores the highest
 * tier reached. Single-step badges always sit at tier 1.
 */
export const achievementTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type AchievementTier = z.infer<typeof achievementTierSchema>;

/**
 * Lucide-react icon name. Kept as a STRING (not a component reference) so the
 * catalogue stays serializable and the API can ship it as JSON. The web maps
 * the name → component in `apps/web/src/features/achievements/icon-map.ts`.
 *
 * NOTE: the enum is whitelisted — adding a new icon means adding it here AND
 * to the web map. This is intentional: we never want a typo'd icon name to
 * silently render a blank cell on the grid.
 */
export const achievementIconNameSchema = z.enum([
  'trophy',
  'star',
  'flame',
  'sparkles',
  'heart',
  'crown',
  'medal',
  'award',
  'gift',
  'coins',
  'users',
  'user-plus',
  'message-square',
  'message-circle',
  'phone',
  'video',
  'mic',
  'moon',
  'sunrise',
  'calendar',
  'cake',
  'rocket',
  'gem',
  'zap',
  'shield',
  'target',
  'compass',
  'send',
]);
export type AchievementIconName = z.infer<typeof achievementIconNameSchema>;

/**
 * The semantic event a `checkAndUnlock(userId, eventKey, payload?)` call is
 * reporting. Each event maps to one or more achievement criteria checks on the
 * server. Centralised as a CLOSED enum so a typo on the call-site (`'call_end'`
 * vs `'callEnd'`) is a compile error rather than a silently-dropped event.
 */
export const achievementEventKeySchema = z.enum([
  /** Fired on every account boot / `/auth/me` refresh — sweeps the time-based set. */
  'session',
  /** Fired once when a call ends; payload carries the duration (ms) + UTC hour. */
  'call_end',
  /** Fired once when a chat message is sent. */
  'message_sent',
  /** Fired once when a friend request is sent. */
  'friend_request_sent',
  /** Fired once when a friend request is accepted (by the accepter side). */
  'friend_accepted',
  /** Fired once after a successful coin purchase or premium subscribe. */
  'purchase',
  /** Fired once when a gift is sent (debit on the sender). */
  'gift_sent',
  /** Fired once when a gift is received (credit on the receiver). */
  'gift_received',
  /** Fired once when a daily-bonus claim succeeds; sweeps the streak set. */
  'daily_bonus_claim',
  /** Fired once when the user is paid out on the leaderboard top. */
  'leaderboard_placement',
  /** Fired once when a referred friend completes signup. */
  'referral_completed',
]);
export type AchievementEventKey = z.infer<typeof achievementEventKeySchema>;

// ── Catalogue ──────────────────────────────────────────────────────────────

/**
 * One row in the static catalogue. The `tiers` array lists the criteria value
 * at each step (e.g. `[10, 100, 500]` for `calls10` → 10/100/500 calls). For
 * single-step badges it holds exactly one value (often `1`, since "send your
 * first" = reach a counter of 1).
 *
 * `criteriaKind` says which counter the tiers compare against — see the
 * service's `evaluateCriteria` for the mapping. The wire/storage stays a flat
 * row; criteria evaluation is server-side.
 */
export interface AchievementCatalogueEntry {
  /** Stable kebab-case id. NEVER renamed — the storage refers to it. */
  id: string;
  category: AchievementCategory;
  icon: AchievementIconName;
  /**
   * What the tiers compare against. `accountAgeDays` reads `User.createdAt`;
   * `callCount` reads the matches collection (`userA|userB`); `callMinutes`
   * sums durations; `friendsCount` counts accepted friendships; etc.
   *
   * Single-step time-of-day badges (`nightOwl`, `earlyBird`) use the special
   * `eventOnce` kind — the tier is the marker value `1` and the criteria is
   * implied by the matching event (an explicit boolean check inside the
   * service, not a counter comparison).
   */
  criteriaKind:
    | 'accountAgeDays'
    | 'accountAgeHours'
    | 'callCount'
    | 'callMinutes'
    | 'friendsCount'
    | 'friendInviteSent'
    | 'friendInviteAccepted'
    | 'purchaseCount'
    | 'giftsSentCount'
    | 'coinsReceivedTotal'
    | 'premiumActive'
    | 'leaderboardTop10Daily'
    | 'leaderboardTop10Weekly'
    | 'leaderboardTop10AllTime'
    | 'chatStarted'
    | 'messagesSentCount'
    | 'giftSentOnce'
    | 'giftReceivedOnce'
    | 'dailyBonusStreak'
    | 'referralCompleted'
    | 'eventOnce';
  /**
   * The threshold(s) for tier 1/2/3 in order. Length 1, 2 or 3 — anything else
   * is invalid and rejected at boot. The tier the user unlocks is the index of
   * the highest threshold their counter has crossed.
   */
  tiers: readonly number[];
  /**
   * `true` if this badge is intentionally hidden from the catalogue until
   * unlocked — used for the easter-egg `nightOwl`/`earlyBird` rows. Hidden
   * badges are still RETURNED from `GET /achievements/catalogue` so the web
   * can render a "?" placeholder card, but with no title/description copy
   * resolved (the web checks the `hidden` flag and shows a generic placeholder
   * for any locked hidden badge). Once unlocked, the title/description are
   * revealed normally on the user's own list.
   */
  hidden?: boolean;
}

/**
 * The full, exhaustive catalogue. 33 entries across 8 categories — keep this
 * in lockstep with the i18n keys (one `achievements.titles.<id>` and
 * `achievements.descriptions.<id>` per row in `apps/web/messages/{ru,en}/
 * profile.json`).
 *
 * Adding a new badge:
 *   1. append a row here,
 *   2. add the matching title/description to BOTH locale files,
 *   3. wire the event in `AchievementsService.evaluateCriteria` if needed.
 */
export const ACHIEVEMENTS_CATALOGUE: readonly AchievementCatalogueEntry[] = [
  // ── Time-based (5) ─────────────────────────────────────────────────────
  { id: 'first-hour', category: 'time', icon: 'sparkles', criteriaKind: 'accountAgeHours', tiers: [1] },
  { id: 'day-1', category: 'time', icon: 'cake', criteriaKind: 'accountAgeDays', tiers: [1] },
  { id: 'week-1', category: 'time', icon: 'calendar', criteriaKind: 'accountAgeDays', tiers: [7] },
  { id: 'month-1', category: 'time', icon: 'calendar', criteriaKind: 'accountAgeDays', tiers: [30] },
  { id: 'year-1', category: 'time', icon: 'crown', criteriaKind: 'accountAgeDays', tiers: [365] },

  // ── Conversation (6) ───────────────────────────────────────────────────
  { id: 'first-call', category: 'conversation', icon: 'video', criteriaKind: 'callCount', tiers: [1] },
  // calls10 escalates 10 → 100 → 500 (Bronze/Silver/Gold).
  { id: 'calls-10', category: 'conversation', icon: 'phone', criteriaKind: 'callCount', tiers: [10, 100, 500] },
  // calls100 escalates 100 → 500 → 1000 (per the spec).
  { id: 'calls-100', category: 'conversation', icon: 'phone', criteriaKind: 'callCount', tiers: [100, 500, 1000] },
  { id: 'minutes-60', category: 'conversation', icon: 'mic', criteriaKind: 'callMinutes', tiers: [60] },
  { id: 'minutes-600', category: 'conversation', icon: 'mic', criteriaKind: 'callMinutes', tiers: [600] },
  { id: 'minutes-6000', category: 'conversation', icon: 'mic', criteriaKind: 'callMinutes', tiers: [6000] },

  // ── Friends (5) ─────────────────────────────────────────────────────────
  { id: 'first-friend', category: 'friends', icon: 'user-plus', criteriaKind: 'friendsCount', tiers: [1] },
  { id: 'friends-10', category: 'friends', icon: 'users', criteriaKind: 'friendsCount', tiers: [10] },
  { id: 'friends-50', category: 'friends', icon: 'users', criteriaKind: 'friendsCount', tiers: [50] },
  { id: 'sent-friend-invite', category: 'friends', icon: 'send', criteriaKind: 'friendInviteSent', tiers: [1] },
  { id: 'got-friend-invite', category: 'friends', icon: 'heart', criteriaKind: 'friendInviteAccepted', tiers: [1] },

  // ── Economy (5) ─────────────────────────────────────────────────────────
  { id: 'first-purchase', category: 'economy', icon: 'coins', criteriaKind: 'purchaseCount', tiers: [1] },
  // top10thRanked maps to "earned a Top placement" (any time).
  { id: 'top-10th-ranked', category: 'economy', icon: 'trophy', criteriaKind: 'leaderboardTop10AllTime', tiers: [1] },
  { id: 'sent-100-gifts', category: 'economy', icon: 'gift', criteriaKind: 'giftsSentCount', tiers: [100] },
  { id: 'received-1000-coins', category: 'economy', icon: 'gem', criteriaKind: 'coinsReceivedTotal', tiers: [1000] },
  { id: 'premium-subscriber', category: 'economy', icon: 'crown', criteriaKind: 'premiumActive', tiers: [1] },

  // ── Top / leaderboard (3) ──────────────────────────────────────────────
  { id: 'top-10-daily', category: 'leaderboard', icon: 'rocket', criteriaKind: 'leaderboardTop10Daily', tiers: [1] },
  { id: 'top-10-weekly', category: 'leaderboard', icon: 'medal', criteriaKind: 'leaderboardTop10Weekly', tiers: [1] },
  { id: 'top-10-all-time', category: 'leaderboard', icon: 'trophy', criteriaKind: 'leaderboardTop10AllTime', tiers: [1] },

  // ── Social interactions (4) ────────────────────────────────────────────
  { id: 'first-chat', category: 'social', icon: 'message-square', criteriaKind: 'chatStarted', tiers: [1] },
  { id: 'messages-100', category: 'social', icon: 'message-circle', criteriaKind: 'messagesSentCount', tiers: [100] },
  { id: 'gave-first-gift', category: 'social', icon: 'gift', criteriaKind: 'giftSentOnce', tiers: [1] },
  { id: 'got-first-gift', category: 'social', icon: 'gift', criteriaKind: 'giftReceivedOnce', tiers: [1] },

  // ── Streak / loyalty (3) ───────────────────────────────────────────────
  { id: 'daily-bonus-7', category: 'streak', icon: 'flame', criteriaKind: 'dailyBonusStreak', tiers: [7] },
  { id: 'daily-bonus-30', category: 'streak', icon: 'flame', criteriaKind: 'dailyBonusStreak', tiers: [30] },
  { id: 'referred-friend', category: 'streak', icon: 'target', criteriaKind: 'referralCompleted', tiers: [1] },

  // ── Hidden / easter eggs (2) ───────────────────────────────────────────
  { id: 'night-owl', category: 'hidden', icon: 'moon', criteriaKind: 'eventOnce', tiers: [1], hidden: true },
  { id: 'early-bird', category: 'hidden', icon: 'sunrise', criteriaKind: 'eventOnce', tiers: [1], hidden: true },
];

/** Convenience: catalogue count for the boot-time invariant + the grid. */
export const ACHIEVEMENTS_COUNT = ACHIEVEMENTS_CATALOGUE.length;

/** Stable id type — a string narrowed to ids that exist in the catalogue. */
export type AchievementId = (typeof ACHIEVEMENTS_CATALOGUE)[number]['id'];

// ── Wire shapes ────────────────────────────────────────────────────────────

/**
 * One unlocked badge as stored + returned. The tier is the HIGHEST the user
 * has reached for this id (e.g. tier=2 means Silver — Bronze is implied).
 */
export const userAchievementUnlockSchema = z.object({
  achievementId: z.string(),
  tier: achievementTierSchema,
  unlockedAt: isoDateSchema,
});
export type UserAchievementUnlock = z.infer<typeof userAchievementUnlockSchema>;

/**
 * Per-badge progress envelope returned to the OWNER on `GET /achievements/me`.
 *
 * `current`/`target` drive the locked card's caption ("3/10 calls"). `tier` is
 * the NEXT tier the user is working toward (1 if nothing unlocked yet); once
 * the highest tier is reached, the row drops out of `progress` and into
 * `unlocked`. Hidden badges (`nightOwl`/`earlyBird`) are excluded from the
 * progress list entirely — they only appear once unlocked.
 */
export const userAchievementProgressSchema = z.object({
  achievementId: z.string(),
  current: z.number().int().nonnegative(),
  target: z.number().int().positive(),
  tier: achievementTierSchema,
});
export type UserAchievementProgress = z.infer<typeof userAchievementProgressSchema>;

/**
 * `GET /achievements/me` envelope — full self-view for the grid page.
 *
 * `checkedAt` is the ISO timestamp the server stamped on the response. The web
 * stores the previous-visit value and detects unlocks newer than it — driving
 * the "Achievement unlocked!" toast WITHOUT a websocket fan-out.
 */
export const myAchievementsSchema = z.object({
  unlocked: z.array(userAchievementUnlockSchema),
  progress: z.array(userAchievementProgressSchema),
  checkedAt: isoDateSchema,
});
export type MyAchievements = z.infer<typeof myAchievementsSchema>;

/**
 * `GET /achievements/user/:userId` envelope — the PUBLIC slice for somebody
 * else's profile. We strip `progress` (it leaks the viewer's own counters
 * onto the public surface) and only return the unlocked badges the target has
 * earned, respecting the same `whoCanViewProfile` gate as the rest of the
 * profile reads (the controller delegates to `ProfilesService` for that).
 */
export const publicAchievementsSchema = z.object({
  unlocked: z.array(userAchievementUnlockSchema),
});
export type PublicAchievements = z.infer<typeof publicAchievementsSchema>;

/**
 * `GET /achievements/catalogue` envelope. Echoes the static catalogue as the
 * wire shape — the web reads this once on app boot and uses it as the source
 * of truth for "what badges exist" (so a server-side catalogue edit reaches
 * old web bundles without a redeploy).
 */
export const achievementsCatalogueSchema = z.object({
  catalogue: z.array(
    z.object({
      id: z.string(),
      category: achievementCategorySchema,
      icon: achievementIconNameSchema,
      tiers: z.array(z.number().int().positive()),
      hidden: z.boolean().optional(),
    }),
  ),
});
export type AchievementsCatalogue = z.infer<typeof achievementsCatalogueSchema>;

/** Re-export the user-id schema so the controller can validate `:userId`. */
export const achievementUserIdParamSchema = objectIdSchema;
