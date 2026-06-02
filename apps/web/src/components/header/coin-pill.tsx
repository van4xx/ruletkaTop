'use client';

/**
 * Coin-balance pill (header) — live balance + a "+" to top up.
 *
 * Wires to {@link useCoinBalance} (TanStack Query against `/wallet`, gated by
 * auth). The pill body links to the wallet; the trailing "+" is its own link
 * straight to the top-up flow so the two affordances are distinct targets. A
 * subtle key-bump animates the number whenever it changes (a purchase landing).
 *
 * States: skeleton shimmer while the balance is unknown; formatted `ru-RU`
 * number once loaded. Memoised on the numeric value.
 */
import { memo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Coins, Plus } from 'lucide-react';
import { ROUTES } from '@/config/nav';
import { cn } from '@/lib/cn';

interface CoinPillProps {
  /** Current coin balance. `null` while unknown (renders a skeleton). */
  balance: number | null;
  className?: string;
}

function CoinPillImpl({ balance, className }: CoinPillProps) {
  const t = useTranslations('chrome');
  const reduceMotion = useReducedMotion();
  const display = balance === null ? null : new Intl.NumberFormat('ru-RU').format(balance);

  return (
    <div
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-full py-1 pl-2.5 pr-1',
        'border border-border/70 bg-card/40 backdrop-blur transition-colors',
        'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
        className,
      )}
    >
      <Link
        href={ROUTES.wallet}
        aria-label={
          display === null
            ? t('coinPill.balanceAria')
            : t('coinPill.balanceValueAria', { amount: display })
        }
        className="inline-flex items-center gap-1.5 rounded-full text-sm font-medium tabular-nums outline-none"
      >
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
      </Link>
      <Link
        href={ROUTES.coins}
        aria-label={t('coinPill.topUpAria')}
        className={cn(
          'inline-flex h-6 w-6 items-center justify-center rounded-full outline-none',
          'bg-primary/15 text-primary transition-colors',
          'hover:bg-primary/25 group-hover:bg-primary/25',
          'focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

export const CoinPill = memo(CoinPillImpl);
