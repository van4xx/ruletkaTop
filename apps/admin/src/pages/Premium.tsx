import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { adminApi, AdminApiError } from '../lib/api';
import type { AdminSubscriber, Role } from '../lib/types';
import {
  Avatar,
  Badge,
  ConfirmButton,
  DataTable,
  MetricCard,
  PageHeader,
  Pagination,
  RelativeTime,
  fmtInt,
  type BadgeVariant,
  type Column,
} from '../components/kit';

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: 'success',
  canceled: 'warning',
  past_due: 'danger',
  none: 'muted',
};

/**
 * Премиум — subscribers directory (cursor-paginated) with the live active count.
 * Admins can comp premium for N days or revoke it; both route through the real
 * premium service and are audited.
 */
export function Premium({ role }: { role: Role }) {
  const isAdmin = role === 'admin';
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const list = useInfiniteQuery({
    queryKey: ['premium-list'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => adminApi.premium.list(pageParam),
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
  });

  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const activeCount = list.data?.pages[0]?.activeCount ?? 0;

  const grant = useMutation({
    mutationFn: (userId: string) => adminApi.premium.grant(userId, { days: 30 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['premium-list'] }),
    onError: (e) => setError(e instanceof AdminApiError ? e.message : 'Не удалось выдать премиум'),
  });
  const revoke = useMutation({
    mutationFn: (userId: string) => adminApi.premium.revoke(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['premium-list'] }),
    onError: (e) =>
      setError(e instanceof AdminApiError ? e.message : 'Не удалось отозвать премиум'),
  });

  const columns: Column<AdminSubscriber>[] = [
    {
      key: 'user',
      header: 'Подписчик',
      render: (r) => (
        <div className="flex items-center gap-3">
          <Avatar seed={r.userId} label={r.nickname} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium">{r.nickname || '—'}</p>
            <p className="truncate text-xs text-muted-foreground">{r.email || r.userId}</p>
          </div>
        </div>
      ),
    },
    { key: 'plan', header: 'План', render: (r) => <span className="font-medium">{r.plan}</span> },
    {
      key: 'status',
      header: 'Статус',
      render: (r) => <Badge variant={STATUS_VARIANT[r.status] ?? 'muted'}>{r.status}</Badge>,
    },
    {
      key: 'until',
      header: 'До',
      render: (r) =>
        r.currentPeriodEnd ? (
          <RelativeTime iso={r.currentPeriodEnd} />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    ...(isAdmin
      ? [
          {
            key: 'actions',
            header: 'Действия',
            align: 'right' as const,
            render: (r: AdminSubscriber) => (
              <div className="flex justify-end gap-2">
                <ConfirmButton
                  variant="secondary"
                  confirmTitle="Выдать премиум на 30 дней?"
                  confirmLabel="Выдать"
                  loading={grant.isPending}
                  onConfirm={() => grant.mutate(r.userId)}
                >
                  +30д
                </ConfirmButton>
                <ConfirmButton
                  variant="danger"
                  confirmTitle="Отозвать премиум?"
                  confirmLabel="Отозвать"
                  loading={revoke.isPending}
                  onConfirm={() => revoke.mutate(r.userId)}
                >
                  Отозвать
                </ConfirmButton>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader title="Премиум" subtitle="Подписчики, выдача и отзыв доступа." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Активных подписок"
          value={fmtInt(activeCount)}
          loading={list.isLoading}
          accent
        />
        <MetricCard
          label="Загружено записей"
          value={fmtInt(rows.length)}
          loading={list.isLoading}
        />
      </div>

      {error && (
        <p className="mb-4 rounded-xl glass-strong p-3 text-sm text-danger ring-1 ring-danger/30">
          {error}
        </p>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.userId}
        loading={list.isLoading}
        error={list.isError ? 'Не удалось загрузить подписчиков.' : undefined}
        empty={
          <p className="p-8 text-center text-sm text-muted-foreground">Подписчиков пока нет.</p>
        }
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
