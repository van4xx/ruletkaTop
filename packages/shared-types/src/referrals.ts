import { z } from 'zod';
import { isoDateSchema, objectIdSchema, paginationMetaSchema } from './common';

/**
 * 3-tier referral program — shared contract.
 *
 * One-time link per user (`code`, 8-char alphanumeric, generated server-side) is
 * the public handle; when a NEW user signs up under it the referrals service
 * walks the chain UP THREE STEPS so the inviter (T1), the inviter's inviter
 * (T2), and the great-inviter (T3) are all paired to the invitee through a
 * `referraledges` row tagged with the corresponding tier.
 *
 * REWARD RATES — CANONICAL, mirrored by `REFERRAL_TIER_RATES` below:
 *  - T1 (direct):    10 % of each downstream coin PURCHASE, credited to the
 *                    direct inviter. The bonus is gated by the invitee's FIRST
 *                    paid purchase as a bot-defence — a sign-up alone earns nothing.
 *  - T2 (indirect):   3 % to the chain's grandparent.
 *  - T3 (deep):       1 % to the chain's great-grandparent.
 *
 * Lifetime CAP per inviter (`REFERRAL_LIFETIME_CAP_COINS`) prevents a small
 * number of whales pumping a single inviter — a hard ceiling on what one
 * inviter's denormalised `totalEarnedCoins` counter can ever reach.
 *
 * The credit itself happens through the SAME wallet primitive that handles
 * daily-bonus / purchases — a `coinTxType` of `bonus` (or the new `referral`
 * kind, see {@link economy.ts}) with a namespaced, idempotent `refId`
 * (`referral-reward:T{tier}:{purchaserId}:{purchaseLedgerId}`) so a redelivered
 * webhook / retried sweep can never double-credit.
 */

// ─────────────────────────── Tiers ───────────────────────────
/** The three referral tiers — 1 (direct), 2 (indirect), 3 (deep). */
export const referralTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type ReferralTier = z.infer<typeof referralTierSchema>;

/**
 * Canonical reward rates per tier as basis points (1 bp = 0.01 %). Stored as
 * BPS so the integer math the sweeper uses is exact (`coinsSpent * bps / 10_000`),
 * with no floating-point drift on big purchases.
 *
 *   T1 = 1000 bps = 10 %
 *   T2 =  300 bps =  3 %
 *   T3 =  100 bps =  1 %
 */
export const REFERRAL_TIER_BPS: Readonly<Record<ReferralTier, number>> = {
  1: 1000,
  2: 300,
  3: 100,
};

/**
 * Display-friendly percentage view of {@link REFERRAL_TIER_BPS}, computed once
 * so the web/mobile UI doesn't redo the math.
 */
export const REFERRAL_TIER_RATES: Readonly<Record<ReferralTier, number>> = {
  1: REFERRAL_TIER_BPS[1] / 100,
  2: REFERRAL_TIER_BPS[2] / 100,
  3: REFERRAL_TIER_BPS[3] / 100,
};

/**
 * Lifetime coin cap PER INVITER across ALL their referral tiers combined.
 * A hard anti-abuse ceiling — once an inviter's denormalised
 * `totalEarnedCoins` hits this, the sweeper stops crediting them. 5000 coins
 * matches the brief.
 */
export const REFERRAL_LIFETIME_CAP_COINS = 5000;

/**
 * Server-side code length — kept here so the web register form / mobile share
 * sheets can validate user-entered codes against the same length the API
 * generates (avoids a contract drift).
 */
export const REFERRAL_CODE_LENGTH = 8;

/**
 * Loose validation for a referral code — 8 chars, alphanumeric, case-insensitive
 * (the API normalizes to upper-case for storage). Used by `bind` requests +
 * the register-page lookup so a malformed `?ref=` returns a clean 400 instead
 * of a 404 from the unique index miss.
 */
export const referralCodeSchema = z
  .string()
  .length(REFERRAL_CODE_LENGTH, 'validation.referralCodeLength')
  .regex(/^[A-Z0-9]+$/i, 'validation.referralCodeChars');

// ─────────────────────────── Public lookup ───────────────────────────
/**
 * Response of `GET /referrals/lookup/:code` — public, unauthenticated. Used by
 * the register page to show the "Тебя пригласил {nickname}" chip above the
 * form BEFORE the user has an account. Carries the inviter's nickname ONLY —
 * NEVER their email / id / any other PII — so a brute-force scan of codes leaks
 * nothing more than what the inviter already shares on their public profile.
 */
export const referralLookupResponseSchema = z.object({
  valid: z.boolean(),
  /** Inviter's public nickname when `valid: true`; absent otherwise. */
  inviterNickname: z.string().optional(),
});
export type ReferralLookupResponse = z.infer<typeof referralLookupResponseSchema>;

// ─────────────────────────── /referrals/me ───────────────────────────
/**
 * Per-tier denormalised aggregates surfaced on the dashboard. `count` is the
 * size of the downline at that tier; `earnedCoins` is the lifetime sum of
 * coins this user has earned FROM that tier.
 */
export const referralTierStatsSchema = z.object({
  count: z.number().int().nonnegative(),
  earnedCoins: z.number().int().nonnegative(),
});
export type ReferralTierStats = z.infer<typeof referralTierStatsSchema>;

/** Aggregated stats block returned by `GET /referrals/me`. */
export const referralStatsSchema = z.object({
  tier1: referralTierStatsSchema,
  tier2: referralTierStatsSchema,
  tier3: referralTierStatsSchema,
  /** Sum of T1+T2+T3 lifetime earnings; capped at {@link REFERRAL_LIFETIME_CAP_COINS}. */
  totalEarned: z.number().int().nonnegative(),
});
export type ReferralStats = z.infer<typeof referralStatsSchema>;

/** Response of `GET /referrals/me` — the caller's link + downline aggregates. */
export const referralMeResponseSchema = z.object({
  code: z.string(),
  /** Canonical shareable link, e.g. `https://ruletka.top/register?ref=ABCDEFGH`. */
  link: z.string(),
  stats: referralStatsSchema,
});
export type ReferralMeResponse = z.infer<typeof referralMeResponseSchema>;

// ─────────────────────────── Downline list ───────────────────────────
/**
 * Minimal public profile of one downline member surfaced in
 * `GET /referrals/me/list`. Avatar + nickname + id ONLY — NO email, NO country,
 * NO real-name. The downline list is, in effect, a tier-filtered friend-style
 * view of accounts the user invited; the contract deliberately strips any
 * field that would let an inviter dox their downline.
 */
export const referralInviteeProfileSchema = z.object({
  id: objectIdSchema,
  nickname: z.string(),
  avatarUrl: z.string().nullable(),
});
export type ReferralInviteeProfile = z.infer<typeof referralInviteeProfileSchema>;

/** One entry in the downline list. */
export const referralDownlineEntrySchema = z.object({
  invitee: referralInviteeProfileSchema,
  signedUpAt: isoDateSchema,
  /**
   * Whether the invitee has completed at least one PAID coin purchase. T1
   * earnings only start kicking in after this turns `true` — the anti-bot
   * gate — so the UI can render a quiet "waiting on first purchase" badge
   * next to brand-new invitees.
   */
  hasMadeFirstPurchase: z.boolean(),
});
export type ReferralDownlineEntry = z.infer<typeof referralDownlineEntrySchema>;

/** Cursor-paginated downline list response. */
export const referralListResponseSchema = z.object({
  items: z.array(referralDownlineEntrySchema),
  meta: paginationMetaSchema,
});
export type ReferralListResponse = z.infer<typeof referralListResponseSchema>;

// ─────────────────────────── Bind request ───────────────────────────
/**
 * Body of `POST /referrals/bind`. Authenticated; lets a freshly-registered user
 * attach themselves to an inviter when the registration flow could NOT include
 * the code inline (see referrals module docs — this is the no-touch-auth
 * fallback). The server enforces:
 *  - one inviter per invitee (unique index on `referraledges.inviteeId`),
 *  - no self-referrals,
 *  - no cycles (the chain walk caps at T3 anyway),
 * and emits 409 on a re-bind attempt.
 */
export const referralBindDtoSchema = z.object({
  code: referralCodeSchema,
});
export type ReferralBindDto = z.infer<typeof referralBindDtoSchema>;
