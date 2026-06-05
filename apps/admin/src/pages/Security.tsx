import { useQuery } from '@tanstack/react-query';

import { adminApi } from '../lib/api';
import type { AdminSecurityEvent, AdminSession } from '../lib/types';
import {
  Badge,
  DataTable,
  EmptyState,
  MetricCard,
  PageHeader,
  RelativeTime,
  fmtInt,
  type BadgeVariant,
  type Column,
} from '../components/kit';

/** Map a security-event type to a badge variant + a Russian label. */
const EVENT_META: Record<string, { variant: BadgeVariant; label: string }> = {
  'user.banned': { variant: 'danger', label: 'Бан аккаунта' },
  'fingerprint.banned': { variant: 'warning', label: 'Бан отпечатка' },
  'session.revoked': { variant: 'muted', label: 'Отзыв сессии' },
};

/**
 * Безопасность — active refresh sessions (REAL, from the auth `sessions`
 * collection) with their client context, plus a unified security-events feed
 * (REAL — banned users + banned fingerprints + revoked sessions, merged and
 * time-sorted). Admin-only.
 */
export function Security() {
  const sessions = useQuery({
    queryKey: ['security-sessions'],
    queryFn: () => adminApi.security.sessions(),
  });
  const events = useQuery({
    queryKey: ['security-events'],
    queryFn: () => adminApi.security.events(),
  });

  const sessionColumns: Column<AdminSession>[] = [
    {
      key: 'user',
      header: 'Пользователь',
      render: (r) => <span className="font-mono text-xs text-muted-foreground">{r.userId}</span>,
    },
    { key: 'ip', header: 'IP', render: (r) => <span className="tabular-nums">{r.ip ?? '—'}</span> },
    {
      key: 'ua',
      header: 'Устройство',
      render: (r) => (
        <span
          className="block max-w-[22rem] truncate text-xs text-muted-foreground"
          title={r.userAgent ?? undefined}
        >
          {r.device ?? r.userAgent ?? '—'}
        </span>
      ),
    },
    {
      key: 'state',
      header: 'Статус',
      render: (r) =>
        r.revoked ? (
          <Badge variant="danger">отозвана</Badge>
        ) : (
          <Badge variant="success">активна</Badge>
        ),
    },
    {
      key: 'created',
      header: 'Создана',
      align: 'right',
      render: (r) => <RelativeTime iso={r.createdAt} />,
    },
    {
      key: 'expires',
      header: 'Истекает',
      align: 'right',
      render: (r) => <RelativeTime iso={r.expiresAt} />,
    },
  ];

  const eventColumns: Column<AdminSecurityEvent>[] = [
    {
      key: 'type',
      header: 'Тип',
      render: (e) => {
        const m = EVENT_META[e.type];
        return <Badge variant={m?.variant ?? 'muted'}>{m?.label ?? e.type}</Badge>;
      },
    },
    {
      key: 'detail',
      header: 'Событие',
      render: (e) => <span className="block max-w-lg truncate text-sm">{e.detail}</span>,
    },
    {
      key: 'user',
      header: 'Пользователь',
      render: (e) => (
        <span className="font-mono text-xs text-muted-foreground">{e.userId ?? '—'}</span>
      ),
    },
    {
      key: 'at',
      header: 'Когда',
      align: 'right',
      render: (e) => <RelativeTime iso={e.createdAt} />,
    },
  ];

  return (
    <div>
      <PageHeader title="Безопасность" subtitle="Сессии, устройства и события безопасности." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Активных сессий"
          value={sessions.data ? fmtInt(sessions.data.activeCount) : '—'}
          loading={sessions.isLoading}
          accent
        />
        <MetricCard
          label="Сессий показано"
          value={sessions.data ? fmtInt(sessions.data.items.length) : '—'}
          loading={sessions.isLoading}
        />
        <MetricCard
          label="Событий"
          value={events.data ? fmtInt(events.data.items.length) : '—'}
          loading={events.isLoading}
        />
      </div>

      <h2 className="mb-3 font-display text-base font-semibold">Сессии</h2>
      <DataTable
        columns={sessionColumns}
        rows={sessions.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={sessions.isLoading}
        error={sessions.isError ? 'Не удалось загрузить сессии.' : undefined}
        empty={<EmptyState title="Сессий нет" />}
      />

      <h2 className="mb-3 mt-8 font-display text-base font-semibold">События безопасности</h2>
      <DataTable
        columns={eventColumns}
        rows={events.data?.items ?? []}
        rowKey={(e) => e.id}
        loading={events.isLoading}
        error={events.isError ? 'Не удалось загрузить события.' : undefined}
        empty={
          <EmptyState
            title="Событий нет"
            description="Здесь появляются баны аккаунтов и отпечатков, а также отозванные сессии."
          />
        }
      />
    </div>
  );
}
