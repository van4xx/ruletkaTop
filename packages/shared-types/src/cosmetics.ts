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
 * cheapest-first: the two free covers, then the paid ladder.
 *
 * Re-tuned to a 4-rung RU-market ladder so paid covers feel premium:
 *   - free        x2 (aurora, graphite)            — implicitly owned
 *   - entry  200  x2 (sunset, mint)
 *   - mid    500  x3 (mesh, noir, bubbles)
 *   - premium x3 (circuit 1500, galaxy 2000, prismatic 2500) — Pro-only
 *
 * The top three are marketed as "Pro-only" (see {@link PRO_ONLY_COVER_IDS}) —
 * still individually purchasable with coins at their catalogue price, but
 * bundled as part of the Premium Pro plan's "all covers + Pro-only" perk.
 * Consumed by the API `/covers` endpoint, the web picker, and the admin
 * economy tab; the price/tier here is authoritative for purchase.
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
  // Entry-level paid — 200
  {
    id: 'sunset',
    name: 'Sunset Drive',
    tier: 'paid',
    priceCoins: 200,
    accent: 'var(--color-neon-magenta)',
  },
  {
    id: 'mint',
    name: 'Mint Glass',
    tier: 'paid',
    priceCoins: 200,
    accent: 'var(--color-neon-cyan)',
  },
  // Mid-tier — 500
  {
    id: 'mesh',
    name: 'Liquid Mesh',
    tier: 'paid',
    priceCoins: 500,
    accent: 'var(--color-neon-violet)',
  },
  { id: 'noir', name: 'Noir Gold', tier: 'paid', priceCoins: 500, accent: 'oklch(0.82 0.14 85)' },
  {
    id: 'bubbles',
    name: 'Bubblegum',
    tier: 'paid',
    priceCoins: 500,
    accent: 'var(--color-neon-magenta)',
  },
  // Premium / Pro-only — 1500-2500
  {
    id: 'circuit',
    name: 'Neon Circuit',
    tier: 'paid',
    priceCoins: 1500,
    accent: 'var(--color-neon-cyan)',
  },
  {
    id: 'galaxy',
    name: 'Galaxy',
    tier: 'paid',
    priceCoins: 2000,
    accent: 'var(--color-neon-violet)',
  },
  {
    id: 'prismatic',
    name: 'Prismatic',
    tier: 'paid',
    priceCoins: 2500,
    accent: 'var(--color-neon-cyan)',
  },
] as const;

/**
 * Cover ids gated on the Pro tier at *equip* time — the covers service reads
 * this as a Set on the equip path for an O(1) gate check
 * ({@link CoversService.setActive}). Catalogue ownership / purchasing is
 * unaffected; this only refuses to *wear* a Pro-only cover for a non-Pro user.
 *
 * Kept next to the catalogue so the price/tier and the Pro-only set never
 * drift. Chosen to be the three richest paid covers (the 1500 / 2000 / 2500
 * "premium" rung) so the Pro plan's "all covers + Pro-only" perk lines up
 * naturally with the most-premium-feeling rung in the picker.
 */
export const PRO_ONLY_COVER_IDS = ['circuit', 'galaxy', 'prismatic'] as const;
export type ProOnlyCoverId = (typeof PRO_ONLY_COVER_IDS)[number];

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

/* ════════════════════════════════════════════════════════════════════════
 *  AVATAR FRAMES
 *
 *  Mirrors the covers system: a small stable ENUM id keys a hand-built
 *  visual rendered as a decorative ring around the user's avatar (the avatar
 *  URL is unchanged). Two free, eight paid, price tiers 100/200/500/1000.
 *
 *  Ownership / activation differ from covers in one subtle way: a frame is
 *  OPTIONAL. The default is `null` (no frame) and the inventory's
 *  `equipped` may be `null` so a user can take their frame off without
 *  forcing them to wear another.
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * The 10 stable avatar-frame ids (free first, then ascending price). Each id
 * maps to a hand-built renderer in `frame-presets.tsx`.
 */
export const FRAME_IDS = [
  'neon-ring',
  'magenta-pulse',
  'gold-filigree',
  'diamond-shards',
  'constellation',
  'roulette-wheel',
  'holographic',
  'aurora-sweep',
  'vinyl-record',
  'flame',
] as const;

export const frameIdSchema = z.enum(FRAME_IDS);
/** An avatar-frame identifier (one of {@link FRAME_IDS}). */
export type FrameId = z.infer<typeof frameIdSchema>;

/** Pricing/ownership tier for a frame (same vocabulary as covers). */
export const frameTierSchema = z.enum(['free', 'paid']);
export type FrameTier = z.infer<typeof frameTierSchema>;

/**
 * Catalogue contract for a single frame. Mirrors {@link profileCoverSchema}
 * shape (id/name/tier/priceCoins/accent) so the picker UI can share its
 * primitives.
 */
export const frameDesignSchema = z.object({
  id: frameIdSchema,
  name: z.string(),
  tier: frameTierSchema,
  /** Coin price; always `0` for free frames. */
  priceCoins: z.number().int().nonnegative(),
  /** Dominant accent hue (CSS color / brand-token reference) for UI chrome. */
  accent: z.string(),
});
export type FrameDesign = z.infer<typeof frameDesignSchema>;

/**
 * THE canonical frame catalogue (code-defined, mirroring `COVER_CATALOGUE`).
 * Ordered cheapest-first: 2 free, then the paid price ladder
 * 100/200/200/500/500/500/1000/1000.
 */
/**
 * Re-tuned to a 4-rung RU-market ladder (matches the cover ladder spec):
 *   - free   x2 (neon-ring, magenta-pulse)
 *   - entry  200  x2 (constellation, vinyl-record)
 *   - mid    500  x3 (aurora-sweep, diamond-shards, holographic)
 *   - premium x3 (roulette-wheel 1000, gold-filigree 1000, flame 2000)
 *
 * The enum stays at 10 ids so the on-disk `users.equippedFrame` field doesn't
 * need a back-fill — only the prices move. The fourth ladder rung (2000)
 * carries a single flagship `flame` so the picker has a clear "headline" frame.
 */
export const FRAME_CATALOGUE: readonly FrameDesign[] = [
  {
    id: 'neon-ring',
    name: 'Neon Ring',
    tier: 'free',
    priceCoins: 0,
    accent: 'var(--color-neon-cyan)',
  },
  {
    id: 'magenta-pulse',
    name: 'Magenta Pulse',
    tier: 'free',
    priceCoins: 0,
    accent: 'var(--color-neon-magenta)',
  },
  // Entry-level paid — 200
  {
    id: 'constellation',
    name: 'Constellation',
    tier: 'paid',
    priceCoins: 200,
    accent: 'var(--color-neon-cyan)',
  },
  {
    id: 'vinyl-record',
    name: 'Vinyl Record',
    tier: 'paid',
    priceCoins: 200,
    accent: 'oklch(0.3 0.02 280)',
  },
  // Mid-tier — 500
  {
    id: 'aurora-sweep',
    name: 'Aurora Sweep',
    tier: 'paid',
    priceCoins: 500,
    accent: 'var(--color-neon-violet)',
  },
  {
    id: 'diamond-shards',
    name: 'Diamond Shards',
    tier: 'paid',
    priceCoins: 500,
    accent: 'var(--color-neon-cyan)',
  },
  {
    id: 'holographic',
    name: 'Holographic',
    tier: 'paid',
    priceCoins: 500,
    accent: 'var(--color-neon-violet)',
  },
  // Premium — 1000-2000
  {
    id: 'roulette-wheel',
    name: 'Roulette Wheel',
    tier: 'paid',
    priceCoins: 1000,
    accent: 'oklch(0.55 0.22 25)',
  },
  {
    id: 'gold-filigree',
    name: 'Gold Filigree',
    tier: 'paid',
    priceCoins: 1000,
    accent: 'oklch(0.82 0.14 85)',
  },
  {
    id: 'flame',
    name: 'Flame — Flagship',
    tier: 'paid',
    priceCoins: 2000,
    accent: 'oklch(0.7 0.2 40)',
  },
] as const;

/** The default frame for a profile that has not chosen one — explicitly NONE. */
export const DEFAULT_FRAME_ID: FrameId | null = null;

/** The free frame ids — implicitly owned by everyone, never stored. */
export const FREE_FRAME_IDS: readonly FrameId[] = FRAME_CATALOGUE.filter(
  (f) => f.tier === 'free',
).map((f) => f.id);

/** Request body for purchasing a frame (the caller's own profile). */
export const purchaseFrameSchema = z.object({
  frameId: frameIdSchema,
});
export type PurchaseFrameDto = z.infer<typeof purchaseFrameSchema>;

/**
 * Request body for equipping/un-equipping a frame. Passing `frameId: null`
 * un-equips the current frame (the avatar renders bare).
 */
export const equipFrameSchema = z.object({
  frameId: frameIdSchema.nullable(),
});
export type EquipFrameDto = z.infer<typeof equipFrameSchema>;

/**
 * The owner-only frame inventory returned by `GET /frames/owned` and after a
 * purchase / equip: the currently equipped frame (or `null`) and the full
 * owned set (free ids ∪ purchased ids).
 *
 * Mirrors {@link coverInventorySchema} but `equipped` is nullable since a
 * user can intentionally wear no frame.
 */
export const userFrameSchema = z.object({
  equipped: frameIdSchema.nullable(),
  owned: z.array(frameIdSchema),
});
export type UserFrame = z.infer<typeof userFrameSchema>;
