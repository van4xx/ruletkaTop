/**
 * Feature-local economy API surface.
 *
 * Wraps the shared, typed `api.request` escape hatch with the ACTUAL backend
 * routes for wallet / coins / gifts / premium / top / payments. (The base
 * `api.economy.*` group in `@/lib/api` targets `/economy/*` paths that don't
 * match the NestJS controllers — those live at `/wallet`, `/coin-packages`,
 * `/gifts`, `/premium`, `/top`, `/payments/...`. We keep the correct mapping
 * here so the rest of the feature stays declarative.)
 *
 * Every type is sourced from the `@ruletka/shared-types` contract.
 */
import { api } from '@/lib/api';
import type {
  CheckoutWidgetParams,
  CoinPackage,
  CoinTransaction,
  CoinsCheckoutDto,
  Gift,
  GiftTransaction,
  PremiumPlan,
  SendGiftDto,
  SubscribeDto,
  Subscription,
  TopPlacement,
  TopPurchaseDto,
  Wallet,
} from '@ruletka/shared-types';

/** Cursor-paginated coin ledger envelope returned by the wallet controller. */
export interface CoinTransactionPage {
  items: CoinTransaction[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** The two active Top lanes (priority desc within each). */
export interface TopFeed {
  left: TopPlacement[];
  right: TopPlacement[];
}

export const economyApi = {
  // ── Wallet & coins ──
  wallet: () => api.request<Wallet>('/wallet'),
  transactions: (cursor?: string, limit = 20) =>
    api.request<CoinTransactionPage>('/wallet/transactions', { query: { cursor, limit } }),
  coinPackages: () => api.request<CoinPackage[]>('/coin-packages'),

  // ── Payments (CloudPayments) ──
  coinsCheckout: (dto: CoinsCheckoutDto) =>
    api.request<CheckoutWidgetParams>('/payments/coins/checkout', { method: 'POST', json: dto }),
  /** Server-minted premium subscription checkout (PENDING payment + widget params). */
  premiumCheckout: (dto: SubscribeDto) =>
    api.request<CheckoutWidgetParams>('/payments/premium/checkout', { method: 'POST', json: dto }),

  // ── Gifts ──
  gifts: () => api.request<Gift[]>('/gifts'),
  sendGift: (dto: SendGiftDto) =>
    api.request<GiftTransaction>('/gifts/send', { method: 'POST', json: dto }),

  // ── Premium ──
  premiumPlans: () => api.request<PremiumPlan[]>('/premium/plans'),
  /** Read the current subscription state (no side effects). */
  subscription: () => api.request<Subscription>('/premium/subscription'),
  subscribe: (dto: SubscribeDto) =>
    api.request<Subscription>('/premium/subscribe', { method: 'POST', json: dto }),
  cancelPremium: () => api.request<Subscription>('/premium/cancel', { method: 'POST' }),

  // ── Top feed ──
  topFeed: () => api.request<TopFeed>('/top'),
  purchaseTop: (dto: TopPurchaseDto) =>
    api.request<TopPlacement>('/top/purchase', { method: 'POST', json: dto }),
} as const;

/** Centralised TanStack Query keys for cache coordination across features. */
export const economyKeys = {
  all: ['economy'] as const,
  wallet: () => [...economyKeys.all, 'wallet'] as const,
  transactions: () => [...economyKeys.all, 'transactions'] as const,
  coinPackages: () => [...economyKeys.all, 'coin-packages'] as const,
  gifts: () => [...economyKeys.all, 'gifts'] as const,
  premiumPlans: () => [...economyKeys.all, 'premium-plans'] as const,
  subscription: () => [...economyKeys.all, 'subscription'] as const,
  topFeed: () => [...economyKeys.all, 'top-feed'] as const,
  profile: (id: string) => [...economyKeys.all, 'profile', id] as const,
} as const;
