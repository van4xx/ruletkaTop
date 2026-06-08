'use client';

/**
 * The wallet "hero" — a prominent glass card showing the live coin balance with
 * the gold coin treatment. Handles loading (skeleton) and error states inline.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { animate, motion, useReducedMotion } from 'framer-motion';
import { RefreshCw, TrendingUp, Wallet as WalletIcon } from 'lucide-react';
import { Button, CoinIcon, Skeleton } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/features/economy/format';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * Counts up to `value` once, the first time a real balance arrives — a small
 * premium flourish for the storefront hero. Subsequent balance changes (polled
 * after a top-up) snap to the new value so they read as instant. Honours
 * `prefers-reduced-motion` by skipping the animation entirely.
 */
function useCountUp(value: number, enabled: boolean): number {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const hasRun = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (reduce || hasRun.current) {
      setDisplay(value);
      hasRun.current = true;
      return;
    }
    hasRun.current = true;
    const controls = animate(0, value, {
      duration: 1,
      ease: EASE_OUT,
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [value, enabled, reduce]);

  return enabled ? display : value;
}

export interface BalanceHeroProps {
  balance: number | null;
  isLoading: boolean;
  isError: boolean;
  /** Retry the wallet read (wired to the query's `refetch`). */
  onRetry?: () => void;
  className?: string;
}

export function BalanceHero({
  balance,
  isLoading,
  isError,
  onRetry,
  className,
}: BalanceHeroProps) {
  const t = useTranslations('economy');
  const tc = useTranslations('common');
  const ready = !isLoading && !isError && balance != null;
  const display = useCountUp(balance ?? 0, ready);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, ease: EASE_OUT }}
      className={cn('relative overflow-hidden rounded-3xl', className)}
    >
      {/* Layered gold + aurora wash. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-br from-[color-mix(in_oklch,var(--coin)_22%,transparent)] via-transparent to-[var(--color-neon-violet)]/15"
      />
      <div className="glass-panel absolute inset-0 -z-10 rounded-3xl" aria-hidden="true" />

      <div className="flex flex-col gap-5 p-7 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <span className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <WalletIcon className="h-4 w-4" aria-hidden="true" />
            {t('balanceHero.label')}
          </span>
          <div className="mt-2 flex items-center gap-3">
            <CoinIcon size="xl" glow className="text-[var(--coin)]" />
            {isLoading ? (
              <Skeleton className="h-12 w-40" />
            ) : isError ? (
              <span className="font-display text-2xl font-bold text-muted-foreground">—</span>
            ) : (
              <span
                className="font-display text-5xl font-extrabold tabular-nums leading-none text-foreground"
                aria-label={t('balanceHero.amountAria', { amount: formatNumber(balance ?? 0) })}
              >
                {formatNumber(display)}
              </span>
            )}
            <span className="self-end pb-1 text-base font-medium text-muted-foreground">
              {t('balanceHero.coinsSuffix')}
            </span>
          </div>
          {isError && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p className="text-sm text-destructive">{t('balanceHero.error')}</p>
              {onRetry && (
                <Button
                  variant="outline"
                  size="sm"
                  leadingIcon={<RefreshCw className="h-4 w-4" />}
                  onClick={onRetry}
                >
                  {tc('retry')}
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="inline-flex items-center gap-2 self-start rounded-2xl border border-border/60 bg-card/40 px-4 py-3 text-sm text-muted-foreground sm:self-auto">
          <TrendingUp
            className="h-4 w-4 shrink-0 text-[var(--color-neon-cyan)]"
            aria-hidden="true"
          />
          <span>{t('balanceHero.hint')}</span>
        </div>
      </div>
    </motion.div>
  );
}
