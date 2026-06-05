import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { adminApi } from '../lib/api';
import type { AdminAuditEntry } from '../lib/types';
import {
  Badge,
  DataTable,
  PageHeader,
  Pagination,
  RelativeTime,
  Toolbar,
  useDebounced,
  type Column,
} from '../components/kit';

/**
 * Аудит — the append-only admin action log (REAL, from `admin_audit_logs`),
 * cursor-paginated with an action-prefix filter. Wave-2 action endpoints append
 * here via AuditService, so this view fills out as the panel is used.
 */
export function Audit() {
  const [actionFilter, setActionFilter] = useState('');
  const action = useDebounced(actionFilter.trim(), 350);

  const list = useInfiniteQuery({
    queryKey: ['audit', action],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      adminApi.audit.list({ action: action || undefined, cursor: pageParam, limit: 30 }),
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
  });

  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);

  const columns: Column<AdminAuditEntry>[] = [
    { key: 'action', header: 'Действие', render: (r) => <Badge variant="info">{r.action}</Badge> },
    {
      key: 'actor',
      header: 'Кто',
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.actorEmail ?? r.actorId ?? 'система'}
        </span>
      ),
    },
    {
      key: 'target',
      header: 'Цель',
      render: (r) => (
        <span className="font-mono text-xs text-muted-foreground">
          {r.targetType ? `${r.targetType}:` : ''}
          {r.targetId ?? '—'}
        </span>
      ),
    },
    {
      key: 'meta',
      header: 'Детали',
      render: (r) => (
        <span
          className="block max-w-[24rem] truncate text-xs text-muted-foreground"
          title={r.meta ? JSON.stringify(r.meta) : undefined}
        >
          {r.meta ? JSON.stringify(r.meta) : '—'}
        </span>
      ),
    },
    {
      key: 'when',
      header: 'Когда',
      align: 'right',
      render: (r) => <RelativeTime iso={r.createdAt} />,
    },
  ];

  return (
    <div>
      <PageHeader title="Аудит" subtitle="Журнал действий администраторов (только чтение)." />

      <Toolbar
        search={actionFilter}
        onSearch={setActionFilter}
        searchPlaceholder="Фильтр по действию (напр. wallet.adjust)…"
      />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        error={list.isError ? 'Не удалось загрузить журнал.' : undefined}
        empty={<p className="p-8 text-center text-sm text-muted-foreground">Записей нет.</p>}
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
