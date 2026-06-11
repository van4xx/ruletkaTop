'use client';

/**
 * Tier-filtered downline list. Tabs at the top, infinite query underneath, one
 * row per invitee — minimal public profile (nickname + avatar) + the signup
 * date + a "waiting for first purchase" hint when the canonical T1 row's
 * `hasMadeFirstPurchase` is still false.
 *
 * Pagination uses `useInfiniteQuery` so "Show more" appends pages without
 * shifting scroll.
 */
import { useFormatter, useTranslations } from 'next-intl';
import { Clock, Loader2, UserRound } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@ruletka/ui';

import type { ReferralTier } from '@ruletka/shared-types';

import { cn } from '@/lib/cn';
import { useReferralDownline } from './use-referrals';

interface Props {
  activeTier: ReferralTier;
  onTierChange: (tier: ReferralTier) => void;
}

export function ReferralDownlineList({ activeTier, onTierChange }: Props) {
  const t = useTranslations('social');
  const format = useFormatter();
  const query = useReferralDownline(activeTier);

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section aria-labelledby="ref-downline-heading" className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <h2 id="ref-downline-heading" className="font-display text-lg font-semibold sm:text-xl">
          {t('referrals.downlineTitle')}
        </h2>
        <div
          role="tablist"
          aria-label={t('referrals.downlineTitle')}
          className="inline-flex rounded-full border border-border/70 bg-card/60 p-1"
        >
          {([1, 2, 3] as ReferralTier[]).map((tier) => (
            <button
              key={tier}
              role="tab"
              type="button"
              aria-selected={tier === activeTier}
              onClick={() => onTierChange(tier)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                tier === activeTier
                  ? 'bg-gradient-to-b from-card/90 to-card/40 text-foreground shadow-[0_1px_0_0_color-mix(in_oklch,var(--color-foreground)_8%,transparent)_inset]'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`referrals.tabT${tier}` as 'referrals.tabT1' | 'referrals.tabT2' | 'referrals.tabT3')}
            </button>
          ))}
        </div>
      </header>

      {query.isLoading ? (
        <div className="flex h-32 items-center justify-center rounded-2xl border border-border/70 bg-card/40">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      ) : query.isError ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {t('referrals.loadingError')}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-border/70 bg-card/40 p-6 text-center text-sm text-muted-foreground">
          {t('referrals.downlineEmpty')}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((row) => {
            const signedUpDate = new Date(row.signedUpAt);
            return (
              <li
                key={row.invitee.id}
                className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card/60 p-3"
              >
                <Link
                  href={`/profile/${row.invitee.id}`}
                  className="flex flex-1 items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-card/80 ring-1 ring-border/70">
                    {row.invitee.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.invitee.avatarUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <UserRound
                        className="h-5 w-5 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-semibold">{row.invitee.nickname}</p>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {t('referrals.memberSignedUp', {
                        date: format.dateTime(signedUpDate, { dateStyle: 'medium' }),
                      })}
                    </p>
                  </div>
                </Link>
                {!row.hasMadeFirstPurchase && (
                  <span
                    title={t('referrals.waitingFirstPurchase')}
                    className="rounded-full bg-card/80 px-2.5 py-1 text-xs text-muted-foreground ring-1 ring-border/70"
                  >
                    {t('referrals.waitingFirstPurchase')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {query.hasNextPage && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              t('referrals.loadMore')
            )}
          </Button>
        </div>
      )}
    </section>
  );
}
