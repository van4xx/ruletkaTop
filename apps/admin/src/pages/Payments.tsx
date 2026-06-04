import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { adminApi } from '../lib/api';
import type { AdminPayment } from '../lib/types';
import {
  Badge,
  DataTable,
  MetricCard,
  Money,
  PageHeader,
  Pagination,
  RelativeTime,
  fmtInt,
  type BadgeVariant,
  type Column,
} from '../components/kit';

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  completed: 'success',
  pending: 'warning',
  failed: 'danger',
  refunded: 'info',
};

/**
 * Платежи — revenue + status-funnel KPIs and a cursor-paginated charge log.
 * Both endpoints are live against the `payments` collection.
 */
export function Payments() {
  const stats = useQuery({ queryKey: ['payment-stats'], queryFn: () => adminApi.payments.stats() });

  const list = useInfiniteQuery({
    queryKey: ['payment-list'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => adminApi.payments.list(pageParam),
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
  });

  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const s = stats.data;

  const columns: Column<AdminPayment>[] = [
    { key: 'invoice', header: 'Инвойс', render: (r) => <span className="font-mono text-xs">{r.invoiceId || '—'}</span> },
    { key: 'user', header: 'Пользователь', render: (r) => <span className="font-mono text-xs text-muted-foreground">{r.userId}</span> },
    { key: 'purpose', header: 'Назначение', render: (r) => <span className="text-muted-foreground">{r.purpose}</span> },
    { key: 'amount', header: 'Сумма', align: 'right', render: (r) => <Money amount={r.amount} currency={r.currency || '₽'} /> },
    { key: 'status', header: 'Статус', render: (r) => <Badge variant={STATUS_VARIANT[r.status] ?? 'muted'}>{r.status}</Badge> },
    { key: 'when', header: 'Когда', align: 'right', render: (r) => <RelativeTime iso={r.createdAt} /> },
  ];

  return (
    <div>
      <PageHeader title="Платежи" subtitle="Выручка и история списаний CloudPayments." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Выручка (всего)" value={s ? `${fmtInt(s.revenueRubTotal)} ₽` : '—'} loading={stats.isLoading} accent hint={s ? `+${fmtInt(s.revenueRub24h)} ₽ за 24ч` : undefined} />
        <MetricCard label="Успешных" value={s ? fmtInt(s.completedCount) : '—'} loading={stats.isLoading} />
        <MetricCard label="В ожидании" value={s ? fmtInt(s.pendingCount) : '—'} loading={stats.isLoading} />
        <MetricCard label="Ошибок / возвратов" value={s ? `${fmtInt(s.failedCount)} / ${fmtInt(s.refundedCount)}` : '—'} loading={stats.isLoading} />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        error={list.isError ? 'Не удалось загрузить платежи.' : undefined}
        empty={<p className="p-8 text-center text-sm text-muted-foreground">Платежей пока нет.</p>}
        footer={
          rows.length > 0 ? (
            <Pagination
              hasMore={Boolean(list.hasNextPage)}
              loading={list.isFetchingNextPage}
              loadedCount={rows.length}
              onLoadMore={() => list.fetchNextPage()}
            />
          ) : undefined
        }
      />
    </div>
  );
}
