import { z } from 'zod';

/**
 * Profile-cover cosmetics — the single source of truth shared by the API
 * (catalogue seed + purchase/active validation) and every client renderer
 * (web today, mobile/admin later).
 *
 * A cover is a small STABLE ENUM id (NOT a free-form URL) so the same id maps
 * to a hand-built, on-brand layered visual on each surface. The catalogue below
 * is the authority for tier + price; clients render `id` → a preset and never
 * trust a client-supplied price.
 *
 * Ownership model (mirrors gifts/top, all coin spends final):
 *  - the two FREE covers (`aurora`, `graphite`) are implicitly owned by everyone
 *    and never stored;
 *  - a paid cover is bought once with coins (atomic wallet debit, ledger type
 *    `cover`) and then permanently owned.
 *
 * `aurora` is the DEFAULT and reproduces the historical profile-hero markup
 * verbatim, so existing users see zero visual regression.
 */

/**
 * The 10 stable cover ids, ascending by visual richness / motion complexity.
 * Order here is also the catalogue order (free first, then the price ladder).
 */
export const COVER_IDS = [
  'aurora',
  'graphite',
  'sunset',
  'mint',
  'mesh',
  'noir',
  'bubbles',
  'circuit',
  'galaxy',
  'prismatic',
] as const;

export const coverIdSchema = z.enum(COVER_IDS);
/** A cover identifier (one of {@link COVER_IDS}). */
export type CoverId = z.infer<typeof coverIdSchema>;

/** Pricing/ownership tier for a cover. */
export const coverTierSchema = z.enum(['free', 'paid']);
export type CoverTier = z.infer<typeof coverTierSchema>;

/**
 * Catalogue contract for a single cover. `name` is a display label (clients may
 * localise it via their i18n layer keyed by `id`); `accent` is the dominant
 * brand-token hue used for swatches/affordances around the cover.
 */
export const profileCoverSchema = z.object({
  id: coverIdSchema,
  name: z.string(),
  tier: coverTierSchema,
  /** Coin price; always `0` for free covers. */
  priceCoins: z.number().int().nonnegative(),
  /** Dominant accent hue (a CSS color / brand-token reference) for UI chrome. */
  accent: z.string(),
});
export type ProfileCover = z.infer<typeof profileCoverSchema>;

/**
 * THE canonical cover catalogue (code-defined, like coin packages — covers are
 * render-bound to client presets, so there is no DB collection). Ordered
 * cheapest-first: the two free covers, then the paid ladder 120 → 1500 mirroring
 * the gift price rungs. Consumed by the API `/covers` endpoint and the web
 * picker; the price/tier here is authoritative for purchase.
 */
export const COVER_CATALOGUE: readonly ProfileCover[] = [
  { id: 'aurora', name: 'Aurora', tier: 'free', priceCoins: 0, accent: 'var(--color-neon-violet)' },
  {
    id: 'graphite',
    name: 'Graphite',
    tier: 'free',
    priceCoins: 0,
    accent: 'var(--color-neon-violet)',
  },
  {
    id: 'sunset',
    name: 'Sunset Drive',
    tier: 'paid',
    priceCoins: 120,
    accent: 'var(--color-neon-magenta)',
  },
  { id: 'mint', name: 'Mint Glass', tier: 'paid', priceCoins: 200, accent: 'var(--color-neon-cyan)' },
  {
    id: 'mesh',
    name: 'Liquid Mesh',
    tier: 'paid',
    priceCoins: 350,
    accent: 'var(--color-neon-violet)',
  },
  { id: 'noir', name: 'Noir Gold', tier: 'paid', priceCoins: 500, accent: 'oklch(0.82 0.14 85)' },
  {
    id: 'bubbles',
    name: 'Bubblegum',
    tier: 'paid',
    priceCoins: 700,
    accent: 'var(--color-neon-magenta)',
  },
  {
    id: 'circuit',
    name: 'Neon Circuit',
    tier: 'paid',
    priceCoins: 900,
    accent: 'var(--color-neon-cyan)',
  },
  {
    id: 'galaxy',
    name: 'Galaxy',
    tier: 'paid',
    priceCoins: 1200,
    accent: 'var(--color-neon-violet)',
  },
  {
    id: 'prismatic',
    name: 'Prismatic',
    tier: 'paid',
    priceCoins: 1500,
    accent: 'var(--color-neon-cyan)',
  },
] as const;

/** The default cover for any profile that has not chosen one. */
export const DEFAULT_COVER_ID: CoverId = 'aurora';

/** The free cover ids — implicitly owned by everyone, never stored. */
export const FREE_COVER_IDS: readonly CoverId[] = COVER_CATALOGUE.filter(
  (c) => c.tier === 'free',
).map((c) => c.id);

/** Request body for purchasing / activating a cover (the caller's own profile). */
export const purchaseCoverSchema = z.object({
  coverId: coverIdSchema,
});
export type PurchaseCoverDto = z.infer<typeof purchaseCoverSchema>;

/**
 * The owner-only cover inventory returned by `GET /covers/me` and after a
 * purchase / set-active: the currently active cover and the full owned set
 * (free ids ∪ purchased ids).
 */
export const coverInventorySchema = z.object({
  active: coverIdSchema,
  owned: z.array(coverIdSchema),
});
export type CoverInventory = z.infer<typeof coverInventorySchema>;
