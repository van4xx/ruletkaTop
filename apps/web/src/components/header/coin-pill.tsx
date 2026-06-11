'use client';

/**
 * Coin-balance pill (header) — live balance + click-to-buy.
 *
 * Wires to {@link useCoinBalance} (TanStack Query against `/wallet`, gated by
 * auth). The whole pill is one button that opens the «Купить монеты» modal
 * (the coin storefront) — the trailing "+" stays as a visual affordance but
 * the primary click target is the pill itself, in line with the broader
 * "modal-first" entry-point switch. A subtle key-bump animates the number
 * whenever it changes (a purchase landing). The legacy `/wallet` deep-link
 * lives in the user-menu (and as a SEO fallback), so collapsing the link into
 * a button trades one affordance for a far more discoverable purchase entry.
 *
 * States: skeleton shimmer while the balance is unknown; locale-formatted
 * number once loaded. Memoised on the numeric value.
 */
import { memo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Coins, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/features/economy/format';
import { useModal } from '@/lib/stores/modal-store';

interface CoinPillProps {
  /** Current coin balance. `null` while unknown (renders a skeleton). */
  balance: number | null;
  className?: string;
}

function CoinPillImpl({ balance, className }: CoinPillProps) {
  const t = useTranslations('chrome');
  const tEcon = useTranslations('economy');
  const locale = useLocale();
  const { open } = useModal();
  const reduceMotion = useReducedMotion();
  const display = balance === null ? null : formatNumber(balance, locale);

  const ariaLabel =
    display === null
      ? tEcon('modals.coins.triggerAria')
      : t('coinPill.balanceValueAria', { amount: display });

  return (
    <button
      type="button"
      onClick={() => open('coins')}
      aria-label={ariaLabel}
      title={tEcon('modals.coins.triggerHint')}
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-full py-1 pl-2.5 pr-1 outline-none',
        'border border-border/70 bg-card/40 backdrop-blur transition-colors',
        'hover:border-border-strong hover:bg-card/70',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      <span className="inline-flex items-center gap-1.5 text-sm font-medium tabular-nums">
        <Coins className="h-4 w-4 text-warning" aria-hidden="true" />
        {display === null ? (
          <span
            className="inline-block h-3.5 w-8 animate-pulse rounded bg-muted-foreground/30"
            aria-hidden="true"
          />
        ) : (
          <span className="relative inline-flex min-w-[1ch] justify-end">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={display}
                initial={reduceMotion ? false : { y: -10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { y: 10, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                {display}
              </motion.span>
            </AnimatePresence>
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex h-6 w-6 items-center justify-center rounded-full',
          'bg-primary/15 text-primary transition-colors',
          'group-hover:bg-primary/25',
        )}
      >
        <Plus className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

export const CoinPill = memo(CoinPillImpl);
