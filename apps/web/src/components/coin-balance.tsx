'use client';

/**
 * Coin-balance pill shown in the header.
 *
 * This is a presentational placeholder for the shell: it renders a static
 * balance and a "+" affordance. The economy feature will later feed it a live
 * value (e.g. from `api.economy.wallet()` via TanStack Query) — the props are
 * shaped so that swap is a one-line change.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Coins, Plus } from 'lucide-react';
import { ROUTES } from '@/config/nav';
import { cn } from '@/lib/cn';

export interface CoinBalanceProps {
  /** Current coin balance. `null` while unknown (renders a subtle skeleton). */
  balance?: number | null;
  className?: string;
}

export function CoinBalance({ balance = null, className }: CoinBalanceProps) {
  const t = useTranslations('economy');
  const display = balance === null ? null : new Intl.NumberFormat('ru-RU').format(balance);

  return (
    <Link
      href={ROUTES.top}
      aria-label={
        display === null
          ? t('coinBalance.balanceAria')
          : t('coinBalance.balanceTopUpAria', { amount: display })
      }
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-1.5 py-1',
        'border border-border/70 bg-card/40 backdrop-blur',
        'text-sm font-medium tabular-nums transition-colors hover:bg-card/70',
        className,
      )}
    >
      <Coins className="h-4 w-4 text-warning" aria-hidden="true" />
      {display === null ? (
        <span className="inline-block h-3.5 w-8 animate-pulse rounded bg-muted-foreground/30" />
      ) : (
        <span>{display}</span>
      )}
      <span
        aria-hidden="true"
        className={cn(
          'ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full',
          'bg-primary/15 text-primary transition-colors group-hover:bg-primary/25',
        )}
      >
        <Plus className="h-3.5 w-3.5" />
      </span>
    </Link>
  );
}
