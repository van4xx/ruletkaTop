'use client';

/**
 * A compact three-stat strip summarising the loaded ledger window: total coins
 * received (in), total spent (out), and the operation count. Figures are
 * derived from whatever transactions are currently loaded (cursor-paginated),
 * so the labels make the "за период" framing explicit rather than implying an
 * all-time total.
 */
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { ArrowDownLeft, ArrowUpRight, Receipt } from 'lucide-react';
import type { CoinTransaction } from '@ruletka/shared-types';
import { Skeleton } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/features/economy/format';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export interface WalletStatsProps {
  transactions: CoinTransaction[];
  isLoading: boolean;
  className?: string;
}

export function WalletStats({ transactions, isLoading, className }: WalletStatsProps) {
  const t = useTranslations('economy');
  const { received, spent } = useMemo(() => {
    let received = 0;
    let spent = 0;
    for (const tx of transactions) {
      if (tx.delta > 0) received += tx.delta;
      else spent += -tx.delta;
    }
    return { received, spent };
  }, [transactions]);

  const items = [
    {
      key: 'in',
      label: t('walletStats.received'),
      value: received,
      icon: ArrowDownLeft,
      tone: 'text-success',
      ring: 'bg-success/15 text-success',
    },
    {
      key: 'out',
      label: t('walletStats.spent'),
      value: spent,
      icon: ArrowUpRight,
      tone: 'text-foreground',
      ring: 'bg-muted text-muted-foreground',
    },
    {
      key: 'count',
      label: t('walletStats.operations'),
      value: transactions.length,
      icon: Receipt,
      tone: 'text-foreground',
      ring: 'bg-primary/12 text-primary',
    },
  ] as const;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.05 }}
      className={cn(
        'glass-panel grid grid-cols-1 divide-y divide-border/60 rounded-2xl sm:grid-cols-3 sm:divide-x sm:divide-y-0',
        className,
      )}
    >
      {items.map(({ key, label, value, icon: Icon, tone, ring }) => (
        <div key={key} className="flex items-center gap-3.5 px-5 py-4">
          <span className={cn('inline-flex h-10 w-10 items-center justify-center rounded-xl', ring)}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            {isLoading ? (
              <Skeleton className="mt-1 h-6 w-20" />
            ) : (
              <p className={cn('font-display text-xl font-bold tabular-nums', tone)}>
                {formatNumber(value)}
              </p>
            )}
          </div>
        </div>
      ))}
    </motion.div>
  );
}
