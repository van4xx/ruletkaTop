'use client';

/**
 * Gifts feature hooks: the catalogue and the send flow.
 *
 * Sending debits the caller's wallet server-side. Premium-only gifts are gated
 * (403 for non-premium senders) — we also gate optimistically in the UI. On
 * success we invalidate the wallet so the balance reflects the debit.
 */
import { useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Gift, Rarity, SendGiftDto } from '@ruletka/shared-types';

import { economyApi, economyKeys } from '@/features/economy/api';
import { useEconomyInvalidation } from '@/hooks/wallet/use-wallet';

/** Display order for rarity tiers (legendary first when sorting desc). */
const RARITY_ORDER: Record<Rarity, number> = {
  common: 0,
  rare: 1,
  epic: 2,
  legendary: 3,
};

/**
 * Gift catalogue (public). Pass `enabled: false` to keep a mounted-but-idle
 * consumer (e.g. a closed dialog) from subscribing/fetching the catalogue.
 */
export function useGifts({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: economyKeys.gifts(),
    queryFn: economyApi.gifts,
    enabled,
  });
}

/** Group the catalogue by rarity (legendary → common) for sectioned display. */
export function useGiftsByRarity(gifts: Gift[] | undefined) {
  return useMemo(() => {
    const groups: Record<Rarity, Gift[]> = { legendary: [], epic: [], rare: [], common: [] };
    (gifts ?? []).forEach((g) => groups[g.rarity].push(g));
    // Cheapest-first within each rarity.
    (Object.keys(groups) as Rarity[]).forEach((r) =>
      groups[r].sort((a, b) => a.priceCoins - b.priceCoins),
    );
    const ordered = (Object.keys(groups) as Rarity[])
      .sort((a, b) => RARITY_ORDER[b] - RARITY_ORDER[a])
      .filter((r) => groups[r].length > 0)
      .map((r) => ({ rarity: r, gifts: groups[r] }));
    return ordered;
  }, [gifts]);
}

/** Send-gift mutation. Invalidates the wallet balance on success. */
export function useSendGift() {
  const { invalidateBalance } = useEconomyInvalidation();
  return useMutation({
    mutationFn: (dto: SendGiftDto) => economyApi.sendGift(dto),
    onSuccess: () => {
      void invalidateBalance();
    },
    meta: { keys: economyKeys.gifts() },
  });
}
