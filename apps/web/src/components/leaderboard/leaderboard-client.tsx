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
import { useTranslations } from 'next-intl';
import { Coins, Crown, Gift, TrendingUp } from 'lucide-react';
import type { LeaderboardMetric } from '@ruletka/shared-types';
import { Tabs, TabsContent, TabsList, TabsTrigger, TooltipProvider } from '@ruletka/ui';
import { useAuth } from '@/features/auth';
import { EconomyShell } from '@/components/economy/economy-shell';
import { EmptyState, ErrorState } from '@/components/economy/states';
import { LeaderboardPodium } from './leaderboard-podium';
import { LeaderboardRow, LeaderboardListSkeleton } from './leaderboard-list';
import { useLeaderboard } from './use-leaderboard';

const METRICS: { value: LeaderboardMetric; labelKey: string; icon: typeof Gift }[] = [
  { value: 'gifts', labelKey: 'leaderboard.metricGifts', icon: Gift },
  { value: 'coins', labelKey: 'leaderboard.metricCoins', icon: Coins },
  { value: 'top', labelKey: 'leaderboard.metricTopDays', icon: TrendingUp },
];

/** `misc.leaderboard.*` key suffixes for each metric's empty state. */
const EMPTY_COPY: Record<LeaderboardMetric, { titleKey: string; descriptionKey: string }> = {
  gifts: { titleKey: 'leaderboard.emptyGiftsTitle', descriptionKey: 'leaderboard.emptyGiftsDesc' },
  coins: { titleKey: 'leaderboard.emptyCoinsTitle', descriptionKey: 'leaderboard.emptyCoinsDesc' },
  top: { titleKey: 'leaderboard.emptyTopTitle', descriptionKey: 'leaderboard.emptyTopDesc' },
};

function MetricBoard({ metric }: { metric: LeaderboardMetric }) {
  const t = useTranslations('misc');
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
        title={t('leaderboard.errorTitle')}
        description={t('leaderboard.errorDesc')}
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
        title={t(EMPTY_COPY[metric].titleKey)}
        description={t(EMPTY_COPY[metric].descriptionKey)}
      />
    );
  }

  return (
    <>
      {/* Podium (top 3) */}
      <section
        aria-label={t('leaderboard.podiumAria')}
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
        <section aria-label={t('leaderboard.restAria')}>
          <h2 className="mb-3 px-1 font-display text-sm font-bold uppercase tracking-widest text-muted-foreground">
            {t('leaderboard.ranking')}
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
        <section aria-label={t('leaderboard.myPlaceAria')}>
          <h2 className="mb-3 px-1 font-display text-sm font-bold uppercase tracking-widest text-muted-foreground">
            {t('leaderboard.you')}
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
  const t = useTranslations('misc');
  const [metric, setMetric] = useState<LeaderboardMetric>('gifts');

  return (
    <TooltipProvider delayDuration={200}>
      <EconomyShell
        eyebrow={
          <>
            <Crown className="h-3.5 w-3.5 text-[var(--coin)]" aria-hidden="true" />
            {t('leaderboard.eyebrow')}
          </>
        }
        title={
          <>
            {t('leaderboard.titlePrefix')}{' '}
            <span className="text-gradient-neon">{t('leaderboard.titleAccent')}</span>
          </>
        }
        lede={t('leaderboard.lede')}
      >
        <Tabs
          value={metric}
          onValueChange={(v) => setMetric(v as LeaderboardMetric)}
          className="space-y-8"
        >
          <TabsList variant="pill" aria-label={t('leaderboard.metricTabsAria')}>
            {METRICS.map(({ value, labelKey, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="gap-1.5">
                <Icon className="h-4 w-4" aria-hidden="true" />
                {t(labelKey)}
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
