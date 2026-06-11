'use client';

/**
 * The full coin ledger for the /wallet page — a richer take on the compact
 * `coins/transaction-list`: each row carries an explicit TYPE BADGE
 * (purchase / gift_out / gift_in / top / bonus / refund), a signed delta, the
 * running balance after the operation, and a localized date. A row of filter
 * chips narrows by direction (all / in / out). Handles loading, empty, error
 * and "load more" states in the product's glass aesthetic.
 */
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Crown,
  Gift,
  Image as ImageIcon,
  RotateCcw,
  ShoppingCart,
  Sparkles,
} from 'lucide-react';
import type { CoinTransaction, CoinTxType } from '@ruletka/shared-types';
import { Badge, Button, type BadgeProps, CoinIcon, Skeleton, Spinner } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { formatDateTime, formatNumber } from '@/features/economy/format';
import { EmptyState, ErrorState } from '@/components/economy/states';

type Tone = 'in' | 'out';

const TX_META: Record<CoinTxType, { icon: typeof Gift; tone: Tone; badge: BadgeProps['variant'] }> =
  {
    purchase: { icon: ShoppingCart, tone: 'in', badge: 'coin' },
    bonus: { icon: Sparkles, tone: 'in', badge: 'success' },
    // 3-tier referral reward — incoming, badge tinted accent so a sequence of
    // referral credits is visually distinct from generic bonuses.
    referral: { icon: Sparkles, tone: 'in', badge: 'accent' },
    gift_in: { icon: Gift, tone: 'in', badge: 'success' },
    refund: { icon: RotateCcw, tone: 'in', badge: 'accent' },
    gift_out: { icon: Gift, tone: 'out', badge: 'neutral' },
    top: { icon: Crown, tone: 'out', badge: 'warning' },
    cover: { icon: ImageIcon, tone: 'out', badge: 'accent' },
    // Avatar-frame cosmetic purchase — outgoing like cover, distinct icon
    // (Sparkles) so frame buys are visually distinguishable in the ledger.
    frame: { icon: Sparkles, tone: 'out', badge: 'accent' },
  };

type DirectionFilter = 'all' | 'in' | 'out';

const FILTER_KEYS: { value: DirectionFilter; labelKey: string }[] = [
  { value: 'all', labelKey: 'walletLedger.filterAll' },
  { value: 'in', labelKey: 'walletLedger.filterIn' },
  { value: 'out', labelKey: 'walletLedger.filterOut' },
];

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

function TxRow({ tx, index }: { tx: CoinTransaction; index: number }) {
  const t = useTranslations('economy');
  const locale = useLocale();
  const meta = TX_META[tx.type];
  const Icon = meta.icon;
  const positive = tx.delta > 0;

  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT, delay: Math.min(index, 12) * 0.02 }}
      className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-card/40 sm:gap-4 sm:px-5"
    >
      <span
        className={cn(
          'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
          positive ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="truncate text-sm font-semibold text-foreground">{t(`txType.${tx.type}`)}</p>
          <Badge variant={meta.badge} size="sm" className="hidden sm:inline-flex">
            {meta.tone === 'in' ? t('walletLedger.badgeIn') : t('walletLedger.badgeOut')}
          </Badge>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatDateTime(tx.createdAt, locale)}
        </p>
      </div>

      <div className="flex flex-col items-end">
        <span
          className={cn(
            'inline-flex items-center gap-1 text-sm font-semibold tabular-nums sm:text-base',
            positive ? 'text-success' : 'text-foreground',
          )}
        >
          {positive ? (
            <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {positive ? '+' : ''}
          {formatNumber(tx.delta)}
        </span>
        <span className="inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground tabular-nums">
          <CoinIcon size="xs" className="text-[var(--coin)]" aria-hidden="true" />
          {formatNumber(tx.balanceAfter)}
        </span>
      </div>
    </motion.li>
  );
}

function LedgerSkeleton() {
  return (
    <div className="glass-panel divide-y divide-border/50 rounded-2xl" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

export interface WalletLedgerProps {
  transactions: CoinTransaction[];
  isLoading: boolean;
  isError: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  onRetry?: () => void;
  /** Opens the top-up dialog from the empty state. */
  onTopUp?: () => void;
}

export function WalletLedger({
  transactions,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onRetry,
  onTopUp,
}: WalletLedgerProps) {
  const t = useTranslations('economy');
  const [filter, setFilter] = useState<DirectionFilter>('all');

  const visible = useMemo(() => {
    if (filter === 'all') return transactions;
    return transactions.filter((tx) => TX_META[tx.type].tone === filter);
  }, [transactions, filter]);

  if (isLoading) return <LedgerSkeleton />;

  if (isError) {
    return (
      <ErrorState
        title={t('walletLedger.errorTitle')}
        description={t('walletLedger.errorDescription')}
        onRetry={onRetry}
      />
    );
  }

  if (transactions.length === 0) {
    return (
      <EmptyState
        icon={<ShoppingCart className="h-6 w-6" />}
        title={t('walletLedger.emptyTitle')}
        description={t('walletLedger.emptyDescription')}
        action={
          onTopUp && (
            <Button variant="primary" size="sm" onClick={onTopUp}>
              {t('walletLedger.emptyAction')}
            </Button>
          )
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Direction filter chips */}
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t('walletLedger.filterLabel')}
      >
        {FILTER_KEYS.map((f) => {
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(f.value)}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                active
                  ? 'bg-primary/15 text-foreground ring-1 ring-[var(--color-neon-violet)]/50'
                  : 'glass-panel text-muted-foreground hover:text-foreground',
              )}
            >
              {t(f.labelKey)}
            </button>
          );
        })}
      </div>

      <div className="glass-panel overflow-hidden rounded-2xl">
        {visible.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            {filter === 'in' ? t('walletLedger.noIncome') : t('walletLedger.noSpending')}
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {visible.map((tx, i) => (
              <TxRow key={tx.id} tx={tx} index={i} />
            ))}
          </ul>
        )}

        {hasNextPage && filter === 'all' && (
          <div className="border-t border-border/50 p-3">
            <Button
              variant="ghost"
              size="sm"
              block
              onClick={onLoadMore}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? (
                <Spinner size="sm" tone="current" />
              ) : (
                t('walletLedger.loadMore')
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
