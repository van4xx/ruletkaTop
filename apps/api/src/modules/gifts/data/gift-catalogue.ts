import type { Gift as GiftContract } from '@ruletka/shared-types';

/**
 * The 10 art-variant ids the frontend's <Gift3DArt /> renderer knows how to
 * draw. Each gift catalogue entry maps to exactly one. We keep this as a
 * narrow string-union literal so any mismatch is a typecheck failure.
 */
export type GiftArtVariant =
  | 'rose'
  | 'bear'
  | 'ring'
  | 'heart'
  | 'star'
  | 'cake'
  | 'castle'
  | 'rocket'
  | 'crown'
  | 'cocktail';

/**
 * Seed catalogue entry. Mirrors the shared `Gift` contract minus the server-
 * issued `id`, with one extra hint — `artVariant` — that points the renderer
 * at the right SVG-3D design. The frontend has a `code → artVariant`
 * fallback map for environments where the DB has the legacy shape.
 */
export interface SeedGift extends Omit<GiftContract, 'id'> {
  artVariant: GiftArtVariant;
}

/**
 * The default catalogue, seeded on boot (idempotent upsert by `code`).
 *
 * Re-tuned to a tighter RU-market ladder so paid gifts feel high-value
 * rather than throwaway:
 *
 *   Common   ( 50 –  150)  rose, heart, star, cocktail
 *   Mid      (300 –  700)  cake, teddy bear, crown
 *   Premium  (1500 – 3500) rocket, castle, ring   — premium-only senders
 *
 * Every gift maps to one of the 10 existing art variants so the redesign is
 * fully covered without renderer changes. The seeder runs `$set` (not just
 * `$setOnInsert`) so deployments with the old prices/rarities automatically
 * adopt the new ladder on the next restart — no manual reseed needed.
 *
 * NOTE: a per-sender "Лимит на день: 10" cap for the Premium tier was scoped
 * but intentionally skipped — the gift schema has no daily-counter field and
 * gifts.service has no rate-limit lookup path, so there is no clean spot to
 * enforce it without a new schema (out of scope for this re-tune).
 */
export const SEED_GIFTS: readonly SeedGift[] = [
  // ── Common (50 – 150, cyan tier) ─────────────────────────────────────
  {
    code: 'rose',
    title: 'Rose',
    animationUrl: '/gifts/rose.json',
    priceCoins: 50,
    rarity: 'common',
    isPremiumOnly: false,
    artVariant: 'rose',
  },
  {
    code: 'heart',
    title: 'Heart',
    animationUrl: '/gifts/heart.json',
    priceCoins: 75,
    rarity: 'common',
    isPremiumOnly: false,
    artVariant: 'heart',
  },
  {
    code: 'star',
    title: 'Lucky Star',
    animationUrl: '/gifts/star.json',
    priceCoins: 100,
    rarity: 'common',
    isPremiumOnly: false,
    artVariant: 'star',
  },
  {
    code: 'cocktail',
    title: 'Martini',
    animationUrl: '/gifts/cocktail.json',
    priceCoins: 150,
    rarity: 'common',
    isPremiumOnly: false,
    artVariant: 'cocktail',
  },

  // ── Mid (300 – 700, magenta tier) ────────────────────────────────────
  {
    code: 'cake',
    title: 'Birthday Cake',
    animationUrl: '/gifts/cake.json',
    priceCoins: 300,
    rarity: 'rare',
    isPremiumOnly: false,
    artVariant: 'cake',
  },
  {
    code: 'teddy',
    title: 'Teddy Bear',
    animationUrl: '/gifts/teddy.json',
    priceCoins: 500,
    rarity: 'rare',
    isPremiumOnly: false,
    artVariant: 'bear',
  },
  {
    code: 'crown',
    title: 'Golden Crown',
    animationUrl: '/gifts/crown.json',
    priceCoins: 700,
    rarity: 'epic',
    isPremiumOnly: false,
    artVariant: 'crown',
  },

  // ── Premium (1500 – 3500, gold tier; premium-only senders) ───────────
  {
    code: 'rocket',
    title: 'Skyrocket',
    animationUrl: '/gifts/rocket.json',
    priceCoins: 1500,
    rarity: 'epic',
    isPremiumOnly: true,
    artVariant: 'rocket',
  },
  {
    code: 'castle',
    title: 'Fairytale Castle',
    animationUrl: '/gifts/castle.json',
    priceCoins: 2500,
    rarity: 'legendary',
    isPremiumOnly: true,
    artVariant: 'castle',
  },
  {
    code: 'ring',
    title: 'Diamond Ring',
    animationUrl: '/gifts/ring.json',
    priceCoins: 3500,
    rarity: 'legendary',
    isPremiumOnly: true,
    artVariant: 'ring',
  },
];

/**
 * Legacy gift codes superseded by the re-tuned ladder above. `diamond` is
 * replaced by the new premium-tier `ring` (same art variant, higher price).
 * The seeder deletes these on boot so the picker never shows a stale entry
 * after a redeploy.
 */
export const RETIRED_GIFT_CODES: readonly string[] = ['diamond'];
