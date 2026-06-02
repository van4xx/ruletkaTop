'use client';

/**
 * /leaderboard — community hall-of-fame, wired to `GET /leaderboard`.
 *
 * Three real metric boards (computed server-side from existing data):
 *   • gifts — total value of gifts received
 *   • coins — current coin balance
 *   • top   — cumulative days held in the Top feed
 *
 * Each board renders a top-3 podium + a ranked list, with the caller's own row
 * highlighted (and surfaced separately when they fall outside the top slice).
 * Loading / empty / error states are all handled per board.
 */
import { useState } from 'react';
import { Coins, Crown, Gift, TrendingUp } from 'lucide-react';
import type { LeaderboardMetric } from '@ruletka/shared-types';
import { Tabs, TabsContent, TabsList, TabsTrigger, TooltipProvider } from '@ruletka/ui';
import { useAuth } from '@/features/auth';
import { EconomyShell } from '@/components/economy/economy-shell';
import { EmptyState, ErrorState } from '@/components/economy/states';
import { LeaderboardPodium } from './leaderboard-podium';
import { LeaderboardRow, LeaderboardListSkeleton } from './leaderboard-list';
import { useLeaderboard } from './use-leaderboard';

const METRICS: { value: LeaderboardMetric; label: string; icon: typeof Gift }[] = [
  { value: 'gifts', label: 'Подарки', icon: Gift },
  { value: 'coins', label: 'Монеты', icon: Coins },
  { value: 'top', label: 'Дни в Топе', icon: TrendingUp },
];

const EMPTY_COPY: Record<LeaderboardMetric, { title: string; description: string }> = {
  gifts: {
    title: 'Пока никто не получал подарков',
    description: 'Дарите подарки любимым собеседникам — и они поднимутся в этом зале славы.',
  },
  coins: {
    title: 'Рейтинг по монетам пуст',
    description: 'Пополняйте баланс и поднимайтесь в рейтинге самых заметных участников.',
  },
  top: {
    title: 'Дорожки Топа свободны',
    description: 'Купите место в Топе — и начните копить дни в зале славы.',
  },
};

function MetricBoard({ metric }: { metric: LeaderboardMetric }) {
  const { user } = useAuth();
  const board = useLeaderboard(metric);

  const top3 = board.entries.slice(0, 3);
  const rest = board.entries.slice(3);
  const hasAny = board.entries.length > 0;
  const myId = user?.id ?? null;
  // Show the caller's own rank separately only when it's outside the visible list.
  const showMe =
    board.me && !board.entries.some((e) => e.userId === board.me!.userId) ? board.me : null;

  if (board.isError) {
    return (
      <ErrorState
        title="Не удалось загрузить рейтинг"
        description="Данные временно недоступны. Попробуйте обновить."
        onRetry={board.refetch}
      />
    );
  }

  if (board.isLoading) {
    return (
      <div className="space-y-8">
        <div className="glass-panel rounded-3xl px-4 py-10">
          <LeaderboardListSkeleton count={3} />
        </div>
        <LeaderboardListSkeleton count={6} />
      </div>
    );
  }

  if (!hasAny) {
    return (
      <EmptyState
        icon={<Crown className="h-7 w-7" aria-hidden="true" />}
        title={EMPTY_COPY[metric].title}
        description={EMPTY_COPY[metric].description}
      />
    );
  }

  return (
    <>
      {/* Podium (top 3) */}
      <section
        aria-label="Тройка лидеров"
        className="relative overflow-hidden rounded-3xl px-4 pb-6 pt-12 sm:px-8 sm:pt-14"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-b from-[color-mix(in_oklch,var(--coin)_10%,transparent)] to-transparent"
        />
        <div className="glass-panel absolute inset-0 -z-10 rounded-3xl" aria-hidden="true" />
        <LeaderboardPodium top={top3} metric={metric} />
      </section>

      {/* The rest of the ranking */}
      {rest.length > 0 && (
        <section aria-label="Остальные участники">
          <h2 className="mb-3 px-1 font-display text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Рейтинг
          </h2>
          <ol className="space-y-2.5">
            {rest.map((entry) => (
              <LeaderboardRow
                key={entry.userId}
                entry={entry}
                metric={metric}
                isMe={entry.userId === myId}
              />
            ))}
          </ol>
        </section>
      )}

      {/* The caller's own position, if outside the visible slice. */}
      {showMe && (
        <section aria-label="Ваше место">
          <h2 className="mb-3 px-1 font-display text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Вы
          </h2>
          <ol>
            <LeaderboardRow entry={showMe} metric={metric} isMe />
          </ol>
        </section>
      )}
    </>
  );
}

export function LeaderboardClient() {
  const [metric, setMetric] = useState<LeaderboardMetric>('gifts');

  return (
    <TooltipProvider delayDuration={200}>
      <EconomyShell
        eyebrow={
          <>
            <Crown className="h-3.5 w-3.5 text-[var(--coin)]" aria-hidden="true" />
            Лидеры
          </>
        }
        title={
          <>
            Зал <span className="text-gradient-neon">славы</span>
          </>
        }
        lede="Самые заметные участники сообщества. Поднимайтесь в рейтинге — дарите подарки, пополняйте баланс и держите место в Топе."
      >
        <Tabs
          value={metric}
          onValueChange={(v) => setMetric(v as LeaderboardMetric)}
          className="space-y-8"
        >
          <TabsList variant="pill" aria-label="Метрика рейтинга">
            {METRICS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="gap-1.5">
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          {METRICS.map(({ value }) => (
            <TabsContent key={value} value={value} className="space-y-8 focus-visible:outline-none">
              {/* Mount the active board only, so an inactive tab doesn't fetch. */}
              {metric === value && <MetricBoard metric={value} />}
            </TabsContent>
          ))}
        </Tabs>
      </EconomyShell>
    </TooltipProvider>
  );
}
