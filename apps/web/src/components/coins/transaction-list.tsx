'use client';

/**
 * The coin ledger — a cursor-paginated list of the caller's transactions with
 * type-aware iconography and signed, color-coded deltas. Handles loading,
 * empty, error, and "load more" states.
 */
import {
  ArrowDownLeft,
  ArrowUpRight,
  Gift,
  Crown,
  Sparkles,
  RotateCcw,
  ShoppingCart,
} from 'lucide-react';
import type { CoinTransaction, CoinTxType } from '@ruletka/shared-types';
import { Badge, Button, Skeleton, Spinner } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { formatDateTime, formatNumber } from '@/features/economy/format';
import { EmptyState, ErrorState } from '@/components/economy/states';

const TX_META: Record<
  CoinTxType,
  { label: string; icon: typeof Gift; tone: 'in' | 'out' }
> = {
  purchase: { label: 'Покупка монет', icon: ShoppingCart, tone: 'in' },
  bonus: { label: 'Бонус', icon: Sparkles, tone: 'in' },
  gift_in: { label: 'Подарок получен', icon: Gift, tone: 'in' },
  refund: { label: 'Возврат', icon: RotateCcw, tone: 'in' },
  gift_out: { label: 'Подарок отправлен', icon: Gift, tone: 'out' },
  top: { label: 'Место в Топе', icon: Crown, tone: 'out' },
};

function TxRow({ tx }: { tx: CoinTransaction }) {
  const meta = TX_META[tx.type];
  const Icon = meta.icon;
  const positive = tx.delta > 0;

  return (
    <li className="flex items-center gap-4 px-4 py-3.5">
      <span
        className={cn(
          'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
          positive ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{meta.label}</p>
        <p className="text-xs text-muted-foreground">{formatDateTime(tx.createdAt)}</p>
      </div>
      <div className="flex flex-col items-end">
        <span
          className={cn(
            'inline-flex items-center gap-1 text-sm font-semibold tabular-nums',
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
        <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
          баланс {formatNumber(tx.balanceAfter)}
        </span>
      </div>
    </li>
  );
}

export interface TransactionListProps {
  transactions: CoinTransaction[];
  isLoading: boolean;
  isError: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  onRetry?: () => void;
}

export function TransactionList({
  transactions,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onRetry,
}: TransactionListProps) {
  if (isLoading) {
    return (
      <div className="glass-panel divide-y divide-border/50 rounded-2xl">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3.5">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        title="Не удалось загрузить историю"
        description="История операций временно недоступна."
        onRetry={onRetry}
      />
    );
  }

  if (transactions.length === 0) {
    return (
      <EmptyState
        icon={<ShoppingCart className="h-6 w-6" />}
        title="Пока нет операций"
        description="Купите монеты или отправьте первый подарок — операции появятся здесь."
      />
    );
  }

  return (
    <div className="glass-panel overflow-hidden rounded-2xl">
      <ul className="divide-y divide-border/50">
        {transactions.map((tx) => (
          <TxRow key={tx.id} tx={tx} />
        ))}
      </ul>
      {hasNextPage && (
        <div className="border-t border-border/50 p-3">
          <Button
            variant="ghost"
            size="sm"
            block
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? <Spinner size="sm" tone="current" /> : 'Показать ещё'}
          </Button>
        </div>
      )}
    </div>
  );
}
