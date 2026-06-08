'use client';

/**
 * /top — the SIGNATURE feed (interactive body).
 *
 * Two infinite marquee rows from GET /top (lanes `left`/`right`) scrolling in
 * opposite directions (top → right, bottom → left), pausing on hover. Each card
 * links to /profile/[id]. A "buy a spot" flow (POST /top/purchase) lets anyone
 * bid coins for a placement — more coins ⇒ higher rank.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Crown, Flame, Trophy } from 'lucide-react';
import { Button, TooltipProvider } from '@ruletka/ui';
import { EconomyShell } from '@/components/economy/economy-shell';
import { ErrorState } from '@/components/economy/states';
import { TopFeedMarquee } from '@/components/top/top-feed-marquee';
import { BuySpotDialog } from '@/components/top/buy-spot-dialog';
import { useTopFeed } from '@/features/top/use-top';
import { useCoinBalance } from '@/hooks/wallet/use-wallet';

export function TopClient() {
  const t = useTranslations('economy');
  const feed = useTopFeed();
  const balance = useCoinBalance();
  const [buyOpen, setBuyOpen] = useState(false);

  const total = (feed.data?.left.length ?? 0) + (feed.data?.right.length ?? 0);

  return (
    <TooltipProvider delayDuration={200}>
      <EconomyShell
        eyebrow={
          <>
            <Flame className="h-3.5 w-3.5 text-[var(--color-neon-magenta)]" aria-hidden="true" />
            {t('top.eyebrow')}
          </>
        }
        title={
          <>
            {t('top.titlePrefix')}{' '}
            <span className="text-gradient-neon">{t('top.titleHighlight')}</span>
          </>
        }
        lede={t('top.lede')}
        actions={
          <Button
            size="lg"
            leadingIcon={<Crown className="h-5 w-5" />}
            onClick={() => setBuyOpen(true)}
          >
            {t('top.buySpot')}
          </Button>
        }
      >
        {feed.isError ? (
          <ErrorState
            title={t('top.errorTitle')}
            description={t('top.errorDescription')}
            onRetry={() => feed.refetch()}
          />
        ) : (
          <div className="space-y-8">
            {/* The signature dual marquee. */}
            <div className="relative">
              <TopFeedMarquee
                left={feed.data?.left ?? []}
                right={feed.data?.right ?? []}
                isLoading={feed.isLoading}
              />
            </div>

            {/* Call-to-action band. */}
            <div className="relative overflow-hidden rounded-3xl px-6 py-10 text-center sm:px-12">
              <div
                aria-hidden="true"
                className="absolute inset-0 -z-10 bg-gradient-to-br from-[color-mix(in_oklch,var(--coin)_18%,transparent)] via-card to-[var(--color-neon-violet)]/20"
              />
              <div className="glass-panel absolute inset-0 -z-10 rounded-3xl" aria-hidden="true" />
              <Trophy className="mx-auto h-8 w-8 text-[var(--coin)]" aria-hidden="true" />
              <h2 className="mt-4 font-display text-2xl font-bold tracking-tight sm:text-3xl">
                {t('top.ctaTitle')}
              </h2>
              <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
                {total > 0 ? t('top.ctaWithCount', { count: total }) : t('top.ctaEmpty')}
              </p>
              <Button
                className="mt-6"
                size="lg"
                leadingIcon={<Crown className="h-5 w-5" />}
                onClick={() => setBuyOpen(true)}
              >
                {t('top.ctaButton')}
              </Button>
            </div>
          </div>
        )}
      </EconomyShell>

      <BuySpotDialog open={buyOpen} onClose={() => setBuyOpen(false)} balance={balance} />
    </TooltipProvider>
  );
}
