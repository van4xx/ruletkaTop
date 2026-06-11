'use client';

/**
 * Tiny tier-aware wrapper around {@link useSubscription} so every gated UI
 * affordance reads the SAME source of truth — the server-side `tier` field on
 * the `Subscription` envelope — instead of recomputing the predicate inline.
 *
 * Returns:
 *   - `tier`           : the user's effective tier (`'none' | 'lite' | 'pro'`)
 *                        once subscription data has loaded; `'none'` while loading
 *                        or when signed out.
 *   - `isPro`          : at-or-above Pro (Pro only).
 *   - `isLiteOrAbove`  : at-or-above Lite (Lite OR Pro).
 *   - `isPremium`      : entitled to ANY paid tier (alias of `isLiteOrAbove`).
 *   - `isLoading`      : the subscription query is still resolving.
 *
 * Why a hook (and not a one-liner): the gating UI is sprinkled across many
 * components (plan card matrix, profile glow, friends "upgrade for unlimited"
 * banner, settings incognito toggle, etc.). Centralising the predicates here
 * keeps the wire shape (and the entitlement rule) in one place — flip Lite to
 * `'lite'` here, every caller follows.
 */
import { useMemo } from 'react';

import type { EffectiveTier } from '@ruletka/shared-types';
import { isTierAtOrAbove } from '@ruletka/shared-types';

import { useSubscription } from './use-premium';

export interface UsePremiumTierResult {
  tier: EffectiveTier;
  isPro: boolean;
  isLiteOrAbove: boolean;
  isPremium: boolean;
  isLoading: boolean;
}

/**
 * Resolve the effective tier from the current subscription contract.
 * A user is at `tier` iff their subscription is `active` AND its persisted
 * `tier` is `lite` or `pro`; anything else (no record, `canceled`, expired)
 * resolves to `'none'`.
 */
export function useEffectiveTier(): { tier: EffectiveTier; isLoading: boolean } {
  const sub = useSubscription();
  const tier: EffectiveTier = useMemo(() => {
    if (!sub.data) return 'none';
    if (sub.data.status !== 'active') return 'none';
    // The `tier` field defaults to `'lite'` server-side, so a legacy active
    // subscription without an explicit tier transparently reads as Lite.
    return (sub.data.tier ?? 'lite') as EffectiveTier;
  }, [sub.data]);
  return { tier, isLoading: sub.isLoading };
}

/**
 * Composite hook returning the tier + the at-or-above predicates the gated
 * UI consumes. Re-renders only when the underlying subscription query updates.
 */
export function usePremiumTier(): UsePremiumTierResult {
  const { tier, isLoading } = useEffectiveTier();
  return useMemo(
    () => ({
      tier,
      isPro: isTierAtOrAbove(tier, 'pro'),
      isLiteOrAbove: isTierAtOrAbove(tier, 'lite'),
      // Alias for clarity at call sites that just want "any paid tier".
      isPremium: isTierAtOrAbove(tier, 'lite'),
      isLoading,
    }),
    [tier, isLoading],
  );
}
