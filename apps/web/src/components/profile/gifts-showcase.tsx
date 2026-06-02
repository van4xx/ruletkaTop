'use client';

/**
 * Showcase of gifts a user has received. Duplicate gifts are aggregated with a
 * ×count badge; each tile carries rarity-tinted glow, a rarity-coloured ring,
 * and the gift's animation (video / image / glyph via {@link GiftMedia}). A
 * compact summary header reports the unique count + total coin value.
 *
 * Tiles enter with a staggered pop and lift on hover; motion is neutralised
 * under `prefers-reduced-motion` (globals.css). Loading / empty states included.
 */
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { Gift as GiftIcon, Sparkles } from 'lucide-react';
import type { Rarity } from '@ruletka/shared-types';
import { Badge, CoinIcon, Skeleton, Tooltip, TooltipContent, TooltipTrigger } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/features/economy/format';
import { RARITY_STYLES } from '@/features/gifts/rarity';
import { GiftMedia } from '@/components/gifts/gift-media';
import type { ReceivedGift } from '@/features/profile/use-profile';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const RARITY_ORDER: Record<Rarity, number> = { legendary: 3, epic: 2, rare: 1, common: 0 };

interface Aggregated {
  key: string;
  title: string;
  animationUrl?: string;
  rarity: Rarity;
  count: number;
  valueCoins: number;
}

export function GiftsShowcase({
  gifts,
  isLoading,
  /** Total coin value across ALL received gifts (incl. duplicates). */
  totalValueCoins,
  /** Empty-state copy — tuned per surface ("Пока нет подарков" vs "Подарите первым"). */
  emptyTitle,
  emptyHint,
}: {
  gifts: ReceivedGift[];
  isLoading: boolean;
  totalValueCoins?: number;
  emptyTitle?: string;
  emptyHint?: string;
}) {
  const t = useTranslations('profile');
  const tEconomy = useTranslations('economy');
  const reduce = useReducedMotion();
  const giftFallbackTitle = t('giftFallbackTitle');

  const aggregated = useMemo<Aggregated[]>(() => {
    const map = new Map<string, Aggregated>();
    for (const g of gifts) {
      const key = g.giftId;
      const price = g.priceCoins ?? g.gift?.priceCoins ?? 0;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        existing.valueCoins += price;
      } else {
        map.set(key, {
          key,
          title: g.gift?.title ?? giftFallbackTitle,
          animationUrl: g.gift?.animationUrl,
          rarity: g.gift?.rarity ?? 'common',
          count: 1,
          valueCoins: price,
        });
      }
    }
    // Rarest + most valuable first — the showcase leads with the best gifts.
    return Array.from(map.values()).sort(
      (a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity] || b.valueCoins - a.valueCoins,
    );
  }, [gifts, giftFallbackTitle]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} shape="block" className="aspect-square rounded-2xl" />
        ))}
      </div>
    );
  }

  if (aggregated.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/70 bg-card/30 py-12 text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-card/70 text-[var(--color-neon-magenta)] ring-1 ring-border/70">
          <GiftIcon className="h-7 w-7" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <p className="font-display text-base font-bold">
            {emptyTitle ?? t('giftsShowcase.emptyTitle')}
          </p>
          {emptyHint && (
            <p className="max-w-xs text-pretty text-sm text-muted-foreground">{emptyHint}</p>
          )}
        </div>
      </div>
    );
  }

  const tileVariants: Variants = {
    hidden: reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85, y: 10 },
    show: (i: number) => ({
      opacity: 1,
      scale: 1,
      y: 0,
      transition: { duration: 0.35, delay: reduce ? 0 : i * 0.035, ease: EASE_OUT },
    }),
  };

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Sparkles className="h-4 w-4 text-[var(--color-neon-magenta)]" aria-hidden="true" />
          {t('giftsShowcase.countLine', { count: aggregated.length })}
        </span>
        {totalValueCoins != null && totalValueCoins > 0 && (
          <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums">
            <CoinIcon size="sm" className="text-[var(--coin)]" />
            {formatNumber(totalValueCoins)}
          </span>
        )}
      </div>

      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {aggregated.map((g, i) => {
          const style = RARITY_STYLES[g.rarity];
          return (
            <motion.li
              key={g.key}
              custom={i}
              variants={tileVariants}
              initial="hidden"
              animate="show"
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className="group relative flex aspect-square flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl bg-card/50 p-2 ring-1 transition-transform duration-200 hover:-translate-y-1"
                    style={{
                      boxShadow: `inset 0 0 28px -12px ${style.color}`,
                      // Rarity-tinted ring without leaving the Tailwind ring system.
                      // Falls back gracefully if the colour token is missing.
                      ['--tw-ring-color' as string]: `color-mix(in oklch, ${style.color} 55%, transparent)`,
                    }}
                  >
                    <div
                      aria-hidden="true"
                      className={cn(
                        'absolute inset-0 bg-gradient-to-br opacity-55 transition-opacity duration-200 group-hover:opacity-90',
                        style.glow,
                      )}
                    />
                    {/* Rarity sheen sweep on hover (motion-safe). */}
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute -inset-x-2 -top-1/2 h-[200%] -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent opacity-0 transition-all duration-700 group-hover:translate-x-full group-hover:opacity-100 motion-reduce:hidden"
                    />
                    <div className="relative flex h-14 w-14 items-center justify-center">
                      <GiftMedia url={g.animationUrl ?? ''} title={g.title} rarity={g.rarity} />
                    </div>
                    {g.count > 1 && (
                      <Badge
                        variant="neutral"
                        size="sm"
                        className="absolute right-1.5 top-1.5 bg-background/85 tabular-nums backdrop-blur"
                      >
                        ×{g.count}
                      </Badge>
                    )}
                    <span className="relative line-clamp-1 text-center text-[0.6875rem] font-medium text-foreground/90">
                      {g.title}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <span className="font-medium">{g.title}</span> · {tEconomy(style.labelKey)}
                  {g.count > 1 && ` · ×${g.count}`}
                </TooltipContent>
              </Tooltip>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
