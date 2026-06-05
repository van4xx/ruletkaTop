import { useQuery } from '@tanstack/react-query';

import { adminApi } from '../lib/api';
import type { AdminCall } from '../lib/types';
import {
  Badge,
  Chart,
  Card,
  CardHeader,
  DataTable,
  MetricCard,
  PageHeader,
  RelativeTime,
  fmtInt,
  type Column,
} from '../components/kit';

/** Format a duration in seconds as `m:ss`. */
function fmtDuration(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Звонки — match/call volume KPIs, the video/voice mix, and a recent-calls feed.
 * Live against the analytics-oriented `matches` collection.
 */
export function Calls() {
  const stats = useQuery({ queryKey: ['calls-stats'], queryFn: () => adminApi.calls.stats() });
  const recent = useQuery({ queryKey: ['calls-recent'], queryFn: () => adminApi.calls.recent() });

  const s = stats.data;

  const columns: Column<AdminCall>[] = [
    {
      key: 'type',
      header: 'Тип',
      render: (r) => <Badge variant={r.type === 'video' ? 'accent' : 'info'}>{r.type}</Badge>,
    },
    {
      key: 'a',
      header: 'Участник A',
      render: (r) => (
        <span className="font-mono text-xs text-muted-foreground">{r.participantA ?? '—'}</span>
      ),
    },
    {
      key: 'b',
      header: 'Участник B',
      render: (r) => (
        <span className="font-mono text-xs text-muted-foreground">{r.participantB ?? '—'}</span>
      ),
    },
    {
      key: 'dur',
      header: 'Длит.',
      align: 'right',
      render: (r) => <span className="tabular-nums">{fmtDuration(r.durationSec)}</span>,
    },
    {
      key: 'state',
      header: 'Статус',
      render: (r) =>
        r.endedAt ? (
          <span className="text-muted-foreground">завершён</span>
        ) : (
          <Badge variant="success">в эфире</Badge>
        ),
    },
    {
      key: 'when',
      header: 'Начат',
      align: 'right',
      render: (r) => <RelativeTime iso={r.startedAt} />,
    },
  ];

  return (
    <div>
      <PageHeader title="Звонки" subtitle="Объём сессий рулетки, модальности и недавние звонки." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Звонков (всего)"
          value={s ? fmtInt(s.totalCalls) : '—'}
          loading={stats.isLoading}
        />
        <MetricCard
          label="За 24ч"
          value={s ? fmtInt(s.calls24h) : '—'}
          loading={stats.isLoading}
          accent
        />
        <MetricCard
          label="В эфире"
          value={s ? fmtInt(s.liveCalls) : '—'}
          loading={stats.isLoading}
        />
        <MetricCard
          label="Ср. длительность"
          value={s ? fmtDuration(s.averageDurationSec) : '—'}
          loading={stats.isLoading}
        />
      </div>

      <Card padding="none" className="mb-8">
        <CardHeader title="Видео против голоса" />
        <div className="p-5">
          {stats.isLoading ? (
            <div className="h-[180px] animate-pulse rounded-xl bg-glass" />
          ) : (
            <Chart
              kind="bar"
              height={180}
              data={[
                { label: 'Видео', value: s?.videoCalls ?? 0 },
                { label: 'Голос', value: s?.voiceCalls ?? 0 },
              ]}
            />
          )}
        </div>
      </Card>

      <DataTable
        columns={columns}
        rows={recent.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={recent.isLoading}
        error={recent.isError ? 'Не удалось загрузить звонки.' : undefined}
        empty={<p className="p-8 text-center text-sm text-muted-foreground">Звонков пока нет.</p>}
      />
    </div>
  );
}
