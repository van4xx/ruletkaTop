'use client';

/**
 * GiftCard — a single tile in the catalogue.
 *
 * The redesign drops flat emoji renderers for the inline SVG-3D illustration
 * (<Gift3DArt />). The frame is the project's `glass-panel` with:
 *   - a neon hover-glow tinted by **price tier** (cheap=cyan, mid=magenta,
 *     expensive=gold) — independent of rarity so casual gifts can still feel
 *     fresh while premium gifts read as gold;
 *   - a coin-icon + price at the bottom;
 *   - a "Лимитированный" ribbon on premium-only gifts (the only catalogue
 *     attribute we currently expose for scarcity);
 *   - a hover-revealed "Подарить" button driven by the page's send flow.
 *
 * Mobile-safe by virtue of the parent grid (2 cols on narrow viewports). The
 * tile carries an `aria-label` so screen readers get
 *   "Подарок Rose, 50 монет" instead of separate fragments.
 */
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { Crown, Send } from 'lucide-react';
import type { Gift } from '@ruletka/shared-types';
import { Badge, Button, CoinIcon, Tooltip, TooltipContent, TooltipTrigger } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/features/economy/format';
import { RARITY_STYLES } from '@/features/gifts/rarity';
import { Gift3DArt, resolveGiftVariant, type GiftArtVariant } from './gift-3d-art';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export interface GiftCardProps {
  gift: Gift;
  /** Whether the viewer is a premium member (gates premium-only gifts). */
  isPremium: boolean;
  onSend: (gift: Gift) => void;
  index?: number;
}

/**
 * Map price → visual tier. Thresholds aligned to the seeded catalogue:
 *   common  ≤ 150  → cyan
 *   mid     ≤ 700  → magenta
 *   premium > 700  → gold
 * Independent of rarity so a one-off cheap legendary or expensive common
 * (if ever introduced) still reads right at a glance.
 */
type PriceTier = 'cheap' | 'mid' | 'premium';
function priceTier(priceCoins: number): PriceTier {
  if (priceCoins <= 150) return 'cheap';
  if (priceCoins <= 700) return 'mid';
  return 'premium';
}

const TIER_GLOW: Record<PriceTier, string> = {
  // Use the existing design-system neon CSS variables so the glow matches
  // the rest of the chrome (and shifts under theme changes).
  cheap: 'var(--color-neon-cyan, oklch(0.86 0.16 200))',
  mid: 'var(--color-neon-magenta, oklch(0.7 0.27 330))',
  premium: 'var(--coin, oklch(0.86 0.16 90))',
};

export function GiftCard({ gift, isPremium, onSend, index = 0 }: GiftCardProps) {
  const t = useTranslations('economy');
  const style = RARITY_STYLES[gift.rarity];
  const locked = gift.isPremiumOnly && !isPremium;
  const tier = priceTier(gift.priceCoins);
  const tierGlow = TIER_GLOW[tier];

  // The variant is derived from the gift `code` — the BE seed also writes an
  // `artVariant` field but the shared contract doesn't surface it, so we
  // resolve via the FE code-map (with a `heart` fallback for unknown codes).
  const variant: GiftArtVariant = resolveGiftVariant(gift.code);

  const ariaLabel = `Подарок ${gift.title}, ${formatNumber(gift.priceCoins)} монет`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE_OUT, delay: (index % 8) * 0.04 }}
      className="group relative flex flex-col"
    >
      <div
        role="group"
        aria-label={ariaLabel}
        className={cn(
          'glass-panel relative flex flex-col overflow-hidden rounded-2xl p-3',
          'transition-[transform,box-shadow] duration-300 hover:-translate-y-1',
        )}
        style={{
          // Inset rarity hairline + neon tier glow on hover.
          boxShadow: [
            `inset 0 0 0 1px color-mix(in oklch, ${style.color} 28%, transparent)`,
            `0 0 0 0 color-mix(in oklch, ${tierGlow} 0%, transparent)`,
          ].join(', '),
          // Custom prop consumed by the `:hover` boost below.
          ['--tier-glow' as string]: tierGlow,
        }}
      >
        {/* Hover-only halo — drawn behind the art so it doesn't tint the SVG. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background: `radial-gradient(120% 80% at 50% 0%, color-mix(in oklch, var(--tier-glow) 22%, transparent) 0%, transparent 60%)`,
            boxShadow: `0 12px 36px -8px color-mix(in oklch, var(--tier-glow) 35%, transparent)`,
          }}
        />

        <div className="relative">
          {/* The 3D art — fills the square. */}
          <div
            className={cn(
              'relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl',
              'bg-gradient-to-br',
              style.glow,
            )}
          >
            <div className="relative h-[85%] w-[85%]">
              <Gift3DArt code={gift.code} label={gift.title} />
            </div>
          </div>

          <span className="absolute left-2 top-2">
            <Badge variant={style.badge} size="sm">
              {t(style.labelKey)}
            </Badge>
          </span>

          {/* "Лимитированный" ribbon — anchored top-right, tilted, gold for premium. */}
          {gift.isPremiumOnly && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -right-7 top-3 rotate-45 select-none bg-gradient-to-r from-amber-400 via-yellow-200 to-amber-400 px-8 py-0.5 text-[0.625rem] font-extrabold uppercase tracking-wider text-amber-950 shadow-md"
            >
              Лимитированный
            </span>
          )}

          {gift.isPremiumOnly && (
            <span className="absolute right-2 top-12">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      'inline-flex h-6 w-6 items-center justify-center rounded-full',
                      'bg-[color-mix(in_oklch,var(--warning)_22%,transparent)] text-warning',
                    )}
                  >
                    <Crown className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">{t('giftCard.premiumOnly')}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('giftCard.premiumOnly')}</TooltipContent>
              </Tooltip>
            </span>
          )}
        </div>

        <div className="mt-3 px-1">
          <p className="truncate text-sm font-semibold text-foreground">{gift.title}</p>
          <div className="mt-1 inline-flex items-center gap-1.5">
            <CoinIcon size="sm" className="text-[var(--coin)]" />
            <span className="text-sm font-bold tabular-nums text-foreground">
              {formatNumber(gift.priceCoins)}
            </span>
          </div>
        </div>

        <Button
          size="sm"
          variant={locked ? 'outline' : 'secondary'}
          className="mt-3"
          block
          disabled={locked}
          leadingIcon={locked ? <Crown className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          onClick={() => onSend(gift)}
          // Re-state the same context for the inner button so screen readers
          // still get the gift identity if they jump focus straight to it.
          aria-label={
            locked
              ? `${t('giftCard.premiumLabel')} — ${gift.title}`
              : `${t('giftCard.send')} — ${ariaLabel}`
          }
        >
          {locked ? t('giftCard.premiumLabel') : t('giftCard.send')}
        </Button>
      </div>

      {/* Decorative use only — the variant data-attribute makes diffing in
          screenshots/devtools easier without affecting layout. */}
      <span data-gift-variant={variant} className="hidden" />
    </motion.div>
  );
}
