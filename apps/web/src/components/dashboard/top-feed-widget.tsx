'use client';

/**
 * The dashboard's slice of the SIGNATURE Top feed: the two-direction marquee
 * (top lane → right, bottom lane → left, pause on hover) reused verbatim from
 * the /top page's `TopFeedMarquee`, plus a prominent "Купить место в Топе" CTA
 * that opens the buy-placement modal (fallback → /top).
 *
 * Wired to `useTopFeed` (the same cached query the /top page uses) with proper
 * loading (shimmer rows), empty (graceful lane hints), and error states.
 */
import { Crown, Flame } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@ruletka/ui';
import { TopFeedMarquee } from '@/components/top/top-feed-marquee';
import { ErrorState } from '@/components/economy/states';
import { useTopFeed } from '@/features/top/use-top';
import { MODAL, useAppModals } from '@/hooks/dashboard/use-app-modals';
import { DashboardCard, WidgetHeader } from './dashboard-card';

const TOP_ROUTE = '/top';

export function TopFeedWidget() {
  const t = useTranslations('misc');
  const feed = useTopFeed();
  const modals = useAppModals();

  const total = (feed.data?.left.length ?? 0) + (feed.data?.right.length ?? 0);

  return (
    <DashboardCard label={t('dashboard.topFeedLabel')}>
      <WidgetHeader
        icon={<Flame className="h-4 w-4" aria-hidden="true" />}
        accent="var(--color-neon-magenta)"
        title={t('dashboard.topFeedTitle')}
        count={total > 0 ? total : null}
        href={TOP_ROUTE}
        linkLabel={t('dashboard.topFeedViewAll')}
      />

      {feed.isError ? (
        <ErrorState
          title={t('dashboard.topFeedErrorTitle')}
          description={t('dashboard.topFeedErrorDesc')}
          onRetry={() => feed.refetch()}
        />
      ) : (
        <div className="space-y-5">
          {/* The signature dual marquee — masked edges for a clean fade. */}
          <div className="relative -mx-1">
            <TopFeedMarquee
              left={feed.data?.left ?? []}
              right={feed.data?.right ?? []}
              isLoading={feed.isLoading}
            />
            {/* Side fade masks so cards dissolve into the card edges. */}
            <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-card/80 to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-card/80 to-transparent" />
          </div>

          {/* Buy-placement CTA band. */}
          <div className="relative overflow-hidden rounded-2xl px-5 py-5 sm:flex sm:items-center sm:justify-between sm:gap-4">
            <div
              aria-hidden="true"
              className="absolute inset-0 -z-10 bg-gradient-to-br from-[color-mix(in_oklch,var(--warning)_16%,transparent)] via-transparent to-[var(--color-neon-violet)]/18"
            />
            <div
              className="absolute inset-0 -z-10 rounded-2xl ring-1 ring-border/60"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <h3 className="font-display text-base font-bold tracking-tight">
                {t('dashboard.topFeedCtaTitle')}
              </h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {total > 0 ? t('dashboard.topFeedCtaWithEntries') : t('dashboard.topFeedCtaEmpty')}
              </p>
            </div>
            <Button
              className="mt-3 w-full sm:mt-0 sm:w-auto"
              leadingIcon={<Crown className="h-4 w-4" />}
              onClick={() => modals.open(MODAL.buyTopPlacement, { fallback: TOP_ROUTE })}
            >
              {t('dashboard.topFeedCtaButton')}
            </Button>
          </div>
        </div>
      )}
    </DashboardCard>
  );
}
