'use client';

/**
 * A single coin-package card in the storefront grid. Premium, tactile treatment
 * with the warm gold coin economy color, a bonus ribbon, and a "выгодно"
 * (best-value) highlight on the cheapest-per-coin package.
 */
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import type { CoinPackage } from '@ruletka/shared-types';
import { Badge, Button, CoinIcon } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { formatNumber, formatRub } from '@/features/economy/format';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export interface CoinPackageCardProps {
  pkg: CoinPackage;
  /** Highlight as the best value (lowest price per coin). */
  best?: boolean;
  /** This package is mid-purchase. */
  loading?: boolean;
  /** Any purchase in flight (disables other buttons). */
  disabled?: boolean;
  onBuy: (pkg: CoinPackage) => void;
  index?: number;
}

export function CoinPackageCard({
  pkg,
  best = false,
  loading = false,
  disabled = false,
  onBuy,
  index = 0,
}: CoinPackageCardProps) {
  const t = useTranslations('economy');
  const total = pkg.coins + pkg.bonusCoins;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT, delay: index * 0.05 }}
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-2xl p-6',
        'glass-panel transition-[transform,box-shadow] duration-300 hover:-translate-y-1',
        best && 'ring-1 ring-[var(--color-neon-violet)]/60',
      )}
    >
      {/* Warm gold glow that intensifies on hover. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[radial-gradient(circle,var(--coin)_0%,transparent_70%)] opacity-20 blur-2xl transition-opacity duration-300 group-hover:opacity-40"
      />

      {best && (
        <span className="absolute right-4 top-4">
          <Badge variant="aurora" size="sm">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            {t('package.bestValue')}
          </Badge>
        </span>
      )}

      {/* Stacked-coin glyph. */}
      <span className="relative inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_oklch,var(--coin)_18%,transparent)] ring-1 ring-[color-mix(in_oklch,var(--coin)_35%,transparent)]">
        <CoinIcon size="xl" glow className="text-[var(--coin)]" />
      </span>

      <div className="mt-5">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl font-extrabold tabular-nums text-foreground">
            {formatNumber(pkg.coins)}
          </span>
          <span className="text-sm font-medium text-muted-foreground">
            {t('package.coinsSuffix')}
          </span>
        </div>
        {pkg.bonusCoins > 0 && (
          <p className="mt-1.5 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-neon-cyan)]">
            {t('package.bonus', { amount: formatNumber(pkg.bonusCoins) })}
          </p>
        )}
        {pkg.bonusCoins > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('package.total', { amount: formatNumber(total) })}
          </p>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 pt-2">
        <span className="font-display text-xl font-bold text-foreground">
          {formatRub(pkg.priceRub)}
        </span>
      </div>

      <Button
        className="mt-4"
        block
        variant={best ? 'primary' : 'secondary'}
        loading={loading}
        disabled={disabled && !loading}
        onClick={() => onBuy(pkg)}
        aria-label={t('package.buyAria', {
          coins: formatNumber(pkg.coins),
          price: formatRub(pkg.priceRub),
        })}
      >
        {t('package.buy')}
      </Button>
    </motion.div>
  );
}
