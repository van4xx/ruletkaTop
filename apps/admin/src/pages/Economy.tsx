import { useQuery } from '@tanstack/react-query';
import { Badge, Spinner } from '@ruletka/ui';

import { adminApi } from '../lib/api';
import { PageTitle, StatCard, fmtCoins, fmtDate, fmtInt } from './ui';

/** Map a ledger `kind` to a readable label + tone. Unknown kinds pass through. */
const KIND_META: Record<
  string,
  { label: string; variant: 'success' | 'danger' | 'coin' | 'accent' | 'neutral' }
> = {
  topup: { label: 'Пополнение', variant: 'success' },
  purchase: { label: 'Покупка', variant: 'danger' },
  gift_sent: { label: 'Подарок отправлен', variant: 'danger' },
  gift_received: { label: 'Подарок получен', variant: 'success' },
  top_placement: { label: 'Размещение в Top', variant: 'accent' },
  premium: { label: 'Premium', variant: 'accent' },
  refund: { label: 'Возврат', variant: 'coin' },
};

/**
 * Economy + population overview: aggregate stat cards plus a recent ledger
 * feed. Charts intentionally omitted — clean stat tiles per the brief.
 */
export function Economy() {
  const q = useQuery({ queryKey: ['economy-overview'], queryFn: () => adminApi.economyOverview() });
  const d = q.data;
  const loading = q.isLoading;

  if (q.isError) {
    return (
      <div>
        <PageTitle title="Экономика" subtitle="Монеты, подарки, Top и население платформы." />
        <p className="rounded-2xl glass-strong p-8 text-center text-sm text-danger ring-1 ring-danger/30">
          Не удалось загрузить обзор экономики.
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageTitle title="Экономика" subtitle="Монеты, подарки, Top и население платформы." />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Всего пользователей"
          value={d ? fmtInt(d.totalUsers) : '—'}
          loading={loading}
        />
        <StatCard
          label="Premium"
          value={d ? fmtInt(d.premiumUsers) : '—'}
          loading={loading}
          accent
        />
        <StatCard
          label="Верифицировано"
          value={d ? fmtInt(d.verifiedUsers) : '—'}
          loading={loading}
        />
        <StatCard label="Забанено" value={d ? fmtInt(d.bannedUsers) : '—'} loading={loading} />
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Монет в обороте"
          value={d ? fmtCoins(d.coinsInCirculation) : '—'}
          loading={loading}
        />
        <StatCard
          label="Стоимость подарков"
          value={d ? fmtCoins(d.giftsValueCoins) : '—'}
          loading={loading}
        />
        <StatCard
          label="Активный Top"
          value={d ? fmtInt(d.activeTopPlacements) : '—'}
          loading={loading}
        />
        <StatCard
          label="Новые пользователи"
          value={d ? fmtInt(d.newUsers24h) : '—'}
          hint={d ? `за 24ч · ${fmtInt(d.newUsers7d)} за 7д` : undefined}
          loading={loading}
        />
      </div>

      <section className="glass-strong overflow-hidden rounded-2xl ring-1 ring-border/50">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="font-display text-base font-semibold">Последние транзакции</h2>
          {d && (
            <span className="text-xs text-muted-foreground">
              {d.recentTransactions.length} записей
            </span>
          )}
        </div>

        {loading ? (
          <div className="grid place-items-center py-16">
            <Spinner />
          </div>
        ) : !d || d.recentTransactions.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Транзакций пока нет.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {d.recentTransactions.map((t) => {
              const meta = KIND_META[t.kind] ?? { label: t.kind, variant: 'neutral' as const };
              const positive = t.amountCoins >= 0;
              return (
                <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                  <Badge variant={meta.variant} size="sm">
                    {meta.label}
                  </Badge>
                  <span
                    className="truncate font-mono text-xs text-muted-foreground"
                    title={t.userId}
                  >
                    {t.userId}
                  </span>
                  <span
                    className={`ml-auto shrink-0 tabular-nums text-sm font-semibold ${positive ? 'text-success' : 'text-danger'}`}
                  >
                    {positive ? '+' : ''}
                    {fmtInt(t.amountCoins)}
                  </span>
                  <span className="w-28 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {fmtDate(t.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
