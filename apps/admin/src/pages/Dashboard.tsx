import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { adminApi } from '../lib/api';
import type { AdminTimeseriesMetric } from '../lib/types';
import {
  Card,
  CardHeader,
  Chart,
  MetricCard,
  PageHeader,
  Tabs,
  fmtCoins,
  fmtInt,
} from '../components/kit';

const QUICK_LINKS = [
  { to: '/moderation', title: 'Очередь модерации', desc: 'Жалобы и авто-флаги на проверку.' },
  { to: '/users', title: 'Пользователи', desc: 'Поиск, бан / разбан, роли.' },
  { to: '/economy', title: 'Экономика', desc: 'Монеты, подарки, Top, транзакции.' },
  { to: '/payments', title: 'Платежи', desc: 'Выручка и история списаний.' },
];

const METRIC_TABS: { key: AdminTimeseriesMetric; label: string }[] = [
  { key: 'signups', label: 'Регистрации' },
  { key: 'revenue', label: 'Выручка' },
  { key: 'calls', label: 'Звонки' },
];

/**
 * Landing dashboard — LIVE KPIs from the analytics overview, a switchable
 * timeseries chart, and quick links into the operational sections.
 */
export function Dashboard() {
  const [metric, setMetric] = useState<AdminTimeseriesMetric>('signups');

  const overview = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: () => adminApi.analytics.overview(),
  });
  const series = useQuery({
    queryKey: ['analytics-timeseries', metric],
    queryFn: () => adminApi.analytics.timeseries({ metric, range: '30d' }),
  });

  const d = overview.data;
  const loading = overview.isLoading;

  return (
    <div>
      <PageHeader title="Дашборд" subtitle="Обзор платформы и быстрые действия." />

      {overview.isError ? (
        <Card className="mb-6 text-sm text-danger ring-danger/30">
          Не удалось загрузить статистику.
        </Card>
      ) : (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Пользователей"
            value={d ? fmtInt(d.totalUsers) : '—'}
            loading={loading}
            hint={d ? `+${fmtInt(d.newUsers24h)} за 24ч` : undefined}
          />
          <MetricCard
            label="Онлайн"
            value={d ? fmtInt(d.onlineUsers) : '—'}
            loading={loading}
            accent
          />
          <MetricCard label="Premium" value={d ? fmtInt(d.premiumUsers) : '—'} loading={loading} />
          <MetricCard
            label="Открытых жалоб"
            value={d ? fmtInt(d.openReports) : '—'}
            loading={loading}
          />
          <MetricCard
            label="Монет в обороте"
            value={d ? fmtCoins(d.coinsInCirculation) : '—'}
            loading={loading}
          />
          <MetricCard
            label="Выручка (всего)"
            value={d ? `${fmtInt(d.revenueRubTotal)} ₽` : '—'}
            loading={loading}
            hint={d ? `+${fmtInt(d.revenueRub24h)} ₽ за 24ч` : undefined}
          />
          <MetricCard
            label="Звонков (всего)"
            value={d ? fmtInt(d.callsTotal) : '—'}
            loading={loading}
            hint={d ? `${fmtInt(d.calls24h)} за 24ч` : undefined}
          />
          <MetricCard label="Забанено" value={d ? fmtInt(d.bannedUsers) : '—'} loading={loading} />
        </div>
      )}

      <Card padding="none" className="mb-8">
        <CardHeader
          title="Динамика за 30 дней"
          action={
            <Tabs
              items={METRIC_TABS}
              value={metric}
              onChange={(k) => setMetric(k as AdminTimeseriesMetric)}
            />
          }
        />
        <div className="p-5">
          {series.isLoading ? (
            <div className="h-[220px] animate-pulse rounded-xl bg-glass" />
          ) : (
            <Chart
              kind="line"
              data={(series.data?.points ?? []).map((p) => ({
                label: p.date.slice(5),
                value: p.value,
              }))}
            />
          )}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK_LINKS.map((c) => (
          <NavLink
            key={c.to}
            to={c.to}
            className="glass-strong rounded-2xl p-5 ring-1 ring-border/50 transition-colors hover:ring-border"
          >
            <p className="font-display text-lg font-semibold">{c.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{c.desc}</p>
          </NavLink>
        ))}
      </div>
    </div>
  );
}
