import { z } from 'zod';
import { isoDateSchema, objectIdSchema, raritySchema } from './common';

// ─────────────────────────── Wallet & coins ───────────────────────────
export const walletSchema = z.object({
  userId: objectIdSchema,
  balanceCoins: z.number().int().nonnegative(),
});
export type Wallet = z.infer<typeof walletSchema>;

export const coinTxTypeSchema = z.enum([
  'purchase',
  'gift_out',
  'gift_in',
  'top',
  'cover',
  'bonus',
  'refund',
  /**
   * 3-tier referral reward credit. Distinct from `bonus` so the wallet history
   * UI / admin reconciliation can group referral earnings separately. The
   * ledger row's `refId` namespace is
   * `referral-reward:T{tier}:{purchaserId}:{purchaseLedgerId}` and rides the
   * same partial-unique `(type, refId)` index, so a redelivered webhook or
   * retried sweep can never double-credit the inviter.
   */
  'referral',
]);
export type CoinTxType = z.infer<typeof coinTxTypeSchema>;

export const coinTransactionSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  delta: z.number().int(),
  type: coinTxTypeSchema,
  refId: z.string().nullable(),
  balanceAfter: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
});
export type CoinTransaction = z.infer<typeof coinTransactionSchema>;

export const coinPackageSchema = z.object({
  code: z.string(),
  coins: z.number().int().positive(),
  priceRub: z.number().int().positive(),
  bonusCoins: z.number().int().nonnegative().default(0),
});
export type CoinPackage = z.infer<typeof coinPackageSchema>;

// ─────────────────────────────── Gifts ────────────────────────────────
export const giftSchema = z.object({
  id: objectIdSchema,
  code: z.string(),
  title: z.string(),
  animationUrl: z.string(),
  priceCoins: z.number().int().nonnegative(),
  rarity: raritySchema,
  isPremiumOnly: z.boolean(),
});
export type Gift = z.infer<typeof giftSchema>;

export const giftContextSchema = z.enum(['call', 'chat', 'profile']);
export type GiftContext = z.infer<typeof giftContextSchema>;

export const sendGiftSchema = z.object({
  giftId: objectIdSchema,
  toUserId: objectIdSchema,
  context: giftContextSchema,
  message: z.string().max(200).optional(),
});
export type SendGiftDto = z.infer<typeof sendGiftSchema>;

export const giftTransactionSchema = z.object({
  id: objectIdSchema,
  fromUserId: objectIdSchema,
  toUserId: objectIdSchema,
  giftId: objectIdSchema,
  priceCoins: z.number().int().nonnegative(),
  context: giftContextSchema,
  createdAt: isoDateSchema,
});
export type GiftTransaction = z.infer<typeof giftTransactionSchema>;

// ───────────────────────────── Top feed ───────────────────────────────
export const topLaneSchema = z.enum(['left', 'right']);
export type TopLane = z.infer<typeof topLaneSchema>;

/**
 * Minimal promoted-user display fields embedded on each active Top placement so
 * the `/top` feed renders a card WITHOUT a per-placement `GET /profiles/:id`
 * round-trip (the previous N+1). Mirrors the `friendSummarySchema.profile` pick.
 * OPTIONAL + nullable so the contract stays backward-compatible: an older API (or
 * a placement whose profile no longer resolves) simply omits it, and the client
 * falls back to a generic identicon.
 */
export const topPlacementProfileSchema = z.object({
  id: objectIdSchema,
  nickname: z.string(),
  avatarUrl: z.string().nullable(),
  isPremium: z.boolean(),
});
export type TopPlacementProfile = z.infer<typeof topPlacementProfileSchema>;

export const topPlacementSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  lane: topLaneSchema,
  priority: z.number().int(),
  coinsSpent: z.number().int().nonnegative(),
  startsAt: isoDateSchema,
  expiresAt: isoDateSchema,
  /**
   * Denormalised display profile for the promoted user, batch-loaded server-side.
   * Additive + optional: pre-enrichment clients ignore it; `null` when the
   * promoted user's profile can't be resolved.
   */
  profile: topPlacementProfileSchema.nullish(),
});
export type TopPlacement = z.infer<typeof topPlacementSchema>;

export const topPurchaseSchema = z.object({
  lane: topLaneSchema,
  durationHours: z.number().int().min(1).max(720),
  coins: z.number().int().positive(),
});
export type TopPurchaseDto = z.infer<typeof topPurchaseSchema>;

// ─────────────────────────────── Premium ──────────────────────────────
export const premiumPlanSchema = z.object({
  code: z.string(),
  title: z.string(),
  priceRub: z.number().int().positive(),
  intervalDays: z.number().int().positive(),
  perks: z.array(z.string()),
});
export type PremiumPlan = z.infer<typeof premiumPlanSchema>;

export const subscriptionStatusSchema = z.enum(['active', 'canceled', 'past_due', 'none']);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export const subscriptionSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  plan: z.string(),
  status: subscriptionStatusSchema,
  startedAt: isoDateSchema.nullable(),
  currentPeriodEnd: isoDateSchema.nullable(),
  cancelAtPeriodEnd: z.boolean(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const subscribeSchema = z.object({
  plan: z.string(),
});
export type SubscribeDto = z.infer<typeof subscribeSchema>;
