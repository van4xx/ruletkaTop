import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { adminApi } from '../lib/api';
import { PageTitle, StatCard, fmtCoins, fmtInt } from './ui';

const QUICK_LINKS = [
  { to: '/moderation', title: 'Очередь модерации', desc: 'Жалобы и авто-флаги на проверку.' },
  { to: '/users', title: 'Пользователи', desc: 'Поиск, бан / разбан, роли.' },
  { to: '/economy', title: 'Экономика', desc: 'Монеты, подарки, Top, транзакции.' },
];

/**
 * Landing dashboard. Stat cards are LIVE from the economy overview; the quick
 * links jump into the operational pages.
 */
export function Dashboard() {
  const q = useQuery({ queryKey: ['economy-overview'], queryFn: () => adminApi.economyOverview() });
  const d = q.data;
  const loading = q.isLoading;

  return (
    <div>
      <PageTitle title="Дашборд" subtitle="Обзор платформы и быстрые действия модерации." />

      {q.isError ? (
        <p className="mb-6 rounded-2xl glass-strong p-4 text-sm text-danger ring-1 ring-danger/30">
          Не удалось загрузить статистику.
        </p>
      ) : (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Пользователей"
            value={d ? fmtInt(d.totalUsers) : '—'}
            loading={loading}
            hint={d ? `+${fmtInt(d.newUsers24h)} за 24ч` : undefined}
          />
          <StatCard
            label="Premium"
            value={d ? fmtInt(d.premiumUsers) : '—'}
            loading={loading}
            accent
          />
          <StatCard
            label="Монет в обороте"
            value={d ? fmtCoins(d.coinsInCirculation) : '—'}
            loading={loading}
          />
          <StatCard label="Забанено" value={d ? fmtInt(d.bannedUsers) : '—'} loading={loading} />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        <a
          href={(import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api') + '/metrics'}
          target="_blank"
          rel="noreferrer"
          className="glass-strong rounded-2xl p-5 ring-1 ring-border/50 transition-colors hover:ring-border"
        >
          <p className="font-display text-lg font-semibold">Метрики</p>
          <p className="mt-1 text-sm text-muted-foreground">Prometheus /metrics (для Grafana).</p>
        </a>
      </div>
    </div>
  );
}
