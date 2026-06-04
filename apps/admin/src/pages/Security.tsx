import { useQuery } from '@tanstack/react-query';

import { adminApi } from '../lib/api';
import type { AdminSession } from '../lib/types';
import {
  Badge,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  MetricCard,
  PageHeader,
  RelativeTime,
  fmtInt,
  type Column,
} from '../components/kit';

/**
 * Безопасность — active refresh sessions (REAL, from the auth `sessions`
 * collection) with their client context, plus a security-events feed (Wave-2
 * stub). Admin-only.
 */
export function Security() {
  const sessions = useQuery({ queryKey: ['security-sessions'], queryFn: () => adminApi.security.sessions() });
  const events = useQuery({ queryKey: ['security-events'], queryFn: () => adminApi.security.events() });

  const columns: Column<AdminSession>[] = [
    { key: 'user', header: 'Пользователь', render: (r) => <span className="font-mono text-xs text-muted-foreground">{r.userId}</span> },
    { key: 'ip', header: 'IP', render: (r) => <span className="tabular-nums">{r.ip ?? '—'}</span> },
    {
      key: 'ua',
      header: 'Устройство',
      render: (r) => (
        <span className="block max-w-[22rem] truncate text-xs text-muted-foreground" title={r.userAgent ?? undefined}>
          {r.device ?? r.userAgent ?? '—'}
        </span>
      ),
    },
    {
      key: 'state',
      header: 'Статус',
      render: (r) => (r.revoked ? <Badge variant="danger">отозвана</Badge> : <Badge variant="success">активна</Badge>),
    },
    { key: 'created', header: 'Создана', align: 'right', render: (r) => <RelativeTime iso={r.createdAt} /> },
    { key: 'expires', header: 'Истекает', align: 'right', render: (r) => <RelativeTime iso={r.expiresAt} /> },
  ];

  return (
    <div>
      <PageHeader title="Безопасность" subtitle="Сессии, устройства и события безопасности." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Активных сессий" value={sessions.data ? fmtInt(sessions.data.activeCount) : '—'} loading={sessions.isLoading} accent />
        <MetricCard label="Показано" value={sessions.data ? fmtInt(sessions.data.items.length) : '—'} loading={sessions.isLoading} />
      </div>

      <h2 className="mb-3 font-display text-base font-semibold">Сессии</h2>
      <DataTable
        columns={columns}
        rows={sessions.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={sessions.isLoading}
        error={sessions.isError ? 'Не удалось загрузить сессии.' : undefined}
        empty={<p className="p-8 text-center text-sm text-muted-foreground">Сессий нет.</p>}
      />

      <Card padding="none" className="mt-8">
        <CardHeader title="События безопасности" />
        {events.isLoading ? (
          <div className="grid place-items-center py-12">
            <div className="h-5 w-32 animate-pulse rounded bg-glass" />
          </div>
        ) : (events.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="Событий нет"
            description="Блокировки входа, обнаружение повторного использования токена и баны появятся здесь (Wave 2)."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {events.data?.items.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{e.type}</p>
                  <p className="truncate text-xs text-muted-foreground">{e.detail}</p>
                </div>
                <RelativeTime iso={e.createdAt} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
