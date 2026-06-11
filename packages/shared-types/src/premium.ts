import { z } from 'zod';

/**
 * Premium TIER — the two-tier split (Lite vs Pro) layered on top of the
 * existing single-tier premium model.
 *
 * `lite` is the historical premium baseline (everything the old single tier
 * granted); `pro` is the higher tier with strictly-larger entitlements. All
 * legacy subscription rows are read as `lite` by default so this split is
 * backward-compatible at the data layer (see `subscriptionSchema` in
 * `economy.ts`, which adds an optional `tier` field defaulting to `'lite'`).
 *
 * The enum is consumed by:
 *  - the API's `@RequiresPremiumTier()` guard (403s when below the required
 *    tier) and `PremiumService.hasTierOrAbove()`;
 *  - the daily-bonus credit (Lite=1.5x, Pro=2x, Free=1x);
 *  - the friends cap (`maxFriendsFor(tier)`);
 *  - the covers `proOnly` gate;
 *  - the referral lifetime cap (`liftetimeReferralCapFor(tier)`);
 *  - the settings `incognito` Pro-only privacy mode;
 *  - the web `usePremiumTier` hook + the plan-card matrix.
 */
export const premiumTierSchema = z.enum(['lite', 'pro']);
export type PremiumTier = z.infer<typeof premiumTierSchema>;

/**
 * The "effective" tier for an arbitrary user — either one of the paid tiers
 * (`lite` / `pro`) or `none` for a Free user. Most cross-cutting helpers
 * (multipliers, caps) want this richer view so they can compute deterministic
 * defaults without the caller having to repeat the null-check.
 */
export const effectiveTierSchema = z.enum(['none', 'lite', 'pro']);
export type EffectiveTier = z.infer<typeof effectiveTierSchema>;

/** Tier ordering used by the at-or-above predicate. */
const TIER_ORDER: Record<EffectiveTier, number> = {
  none: 0,
  lite: 1,
  pro: 2,
};

/**
 * Whether `actual` is at-or-above `required`. The single source of truth for
 * the `@RequiresPremiumTier()` guard, the web `isPro` / `isLiteOrAbove`
 * predicates, and every gated-feature server check.
 *
 * Examples:
 *  - `isTierAtOrAbove('pro',  'lite') === true`
 *  - `isTierAtOrAbove('lite', 'pro')  === false`
 *  - `isTierAtOrAbove('none', 'lite') === false`
 */
export function isTierAtOrAbove(actual: EffectiveTier, required: PremiumTier): boolean {
  return TIER_ORDER[actual] >= TIER_ORDER[required];
}

// ── Daily-bonus multiplier ──────────────────────────────────────────────────
/**
 * Per-tier daily-bonus multiplier applied to the {@link DAILY_BONUS_LADDER}
 * value before crediting:
 *  - Free → 1.0x (baseline; 30 coins/week)
 *  - Lite → 1.5x (45 coins/week)
 *  - Pro  → 2.0x (60 coins/week)
 *
 * The ladder itself is NOT mutated — the multiplier is applied at the credit
 * site (see `DailyBonusService.claim`) and a floor is taken so the credited
 * amount is always an integer.
 */
export const DAILY_BONUS_TIER_MULTIPLIER: Readonly<Record<EffectiveTier, number>> = {
  none: 1.0,
  lite: 1.5,
  pro: 2.0,
};

/**
 * Apply the tier multiplier to a base ladder rung. Integer-floor so the
 * wallet ledger stays integer-clean (the wallet's `assertPositiveInt` would
 * otherwise reject a fractional credit).
 */
export function multipliedDailyBonus(baseCoins: number, tier: EffectiveTier): number {
  return Math.floor(baseCoins * DAILY_BONUS_TIER_MULTIPLIER[tier]);
}

// ── Friends cap ─────────────────────────────────────────────────────────────
/**
 * Per-tier friend-list cap. The acceptFriendRequest path consults this and
 * refuses to flip a `pending` row to `accepted` once the caller is at-cap.
 * `Number.POSITIVE_INFINITY` is the standard sentinel for "no cap" (Pro).
 */
export const FRIEND_LIMITS: Readonly<Record<EffectiveTier, number>> = {
  none: 100,
  lite: 500,
  pro: Number.POSITIVE_INFINITY,
};

/** Convenience: the friend-list cap for a given effective tier. */
export function maxFriendsFor(tier: EffectiveTier): number {
  return FRIEND_LIMITS[tier];
}

// ── Referral lifetime cap ────────────────────────────────────────────────────
/**
 * Per-tier referral lifetime cap. Pro lifts the cap from 5000 → 20000 coins
 * lifetime so a Pro inviter actually has headroom to monetise their downline.
 *
 * The cap is consulted INSIDE the per-tier reward loop (`creditPurchaseRewards`)
 * against the inviter's still-true tier at the moment of the credit, so a tier
 * downgrade re-clamps subsequent credits to the lower cap (existing credits are
 * not retroactively clawed back — that's a deliberate product choice).
 */
export const REFERRAL_LIFETIME_CAP_BY_TIER: Readonly<Record<EffectiveTier, number>> = {
  none: 5000,
  lite: 5000,
  pro: 20000,
};

/** Convenience: the lifetime referral cap for a given effective tier. */
export function lifetimeReferralCapFor(tier: EffectiveTier): number {
  return REFERRAL_LIFETIME_CAP_BY_TIER[tier];
}

// ── Pro-only covers ──────────────────────────────────────────────────────────
/**
 * The list of cover ids gated on Pro at equip-time is OWNED by `cosmetics.ts`
 * as `PRO_ONLY_COVER_IDS` (single source of truth: kept next to the catalogue
 * itself so the price/tier and the Pro-only set never drift). The covers
 * service reads it as a Set on the equip path for an O(1) gate check (see
 * `CoversService.setActive`).
 */

// ── Feature matrix ───────────────────────────────────────────────────────────
/**
 * The six concrete differences between Free / Lite / Pro, surfaced verbatim
 * in the plan-card matrix. Keys are stable so the web layer can localise the
 * row labels via i18n keys without the contract owning the copy.
 */
export const PREMIUM_TIER_FEATURE_MATRIX = [
  {
    key: 'dailyBonusMultiplier',
    free: '1x',
    lite: '1.5x',
    pro: '2x',
  },
  {
    key: 'profileBadgeGlow',
    free: false,
    lite: 'silver',
    pro: 'gold-shimmer',
  },
  {
    key: 'friendLimit',
    free: 100,
    lite: 500,
    pro: 'unlimited',
  },
  {
    key: 'proOnlyCovers',
    free: false,
    lite: false,
    pro: true,
  },
  {
    key: 'referralCap',
    free: 5000,
    lite: 5000,
    pro: 20000,
  },
  {
    key: 'incognito',
    free: false,
    lite: false,
    pro: true,
  },
] as const;
export type PremiumTierFeatureRow = (typeof PREMIUM_TIER_FEATURE_MATRIX)[number];
