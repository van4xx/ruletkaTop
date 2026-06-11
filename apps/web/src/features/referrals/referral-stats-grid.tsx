'use client';

/**
 * Three tier cards (T1/T2/T3) + a tiny "total earned" footer. Each card shows
 * the tier label, percentage, downline count and lifetime coin earnings from
 * that tier.
 *
 * The visual hierarchy is intentional: T1 has the highest reward + first-purchase
 * gate, so it carries the most prominent accent; T2/T3 step the saturation down
 * to mirror the diminishing reward rate.
 */
import { useTranslations } from 'next-intl';
import { Coins, Crown, Sparkles, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { ReferralStats, ReferralTier } from '@ruletka/shared-types';

import { cn } from '@/lib/cn';

interface Props {
  stats: ReferralStats | undefined;
  isLoading: boolean;
}

interface TierVisual {
  tier: ReferralTier;
  icon: LucideIcon;
  /** Tailwind accent ring/glow for the card. */
  accent: string;
  pctKey: 'referrals.tier1Pct' | 'referrals.tier2Pct' | 'referrals.tier3Pct';
  labelKey: 'referrals.tier1Label' | 'referrals.tier2Label' | 'referrals.tier3Label';
}

const TIER_VISUALS: TierVisual[] = [
  {
    tier: 1,
    icon: Crown,
    accent:
      'from-[color-mix(in_oklch,var(--color-neon-violet)_30%,transparent)] to-transparent ring-[color-mix(in_oklch,var(--color-neon-violet)_60%,var(--color-border))]',
    pctKey: 'referrals.tier1Pct',
    labelKey: 'referrals.tier1Label',
  },
  {
    tier: 2,
    icon: Sparkles,
    accent:
      'from-[color-mix(in_oklch,var(--color-neon-cyan)_22%,transparent)] to-transparent ring-[color-mix(in_oklch,var(--color-neon-cyan)_45%,var(--color-border))]',
    pctKey: 'referrals.tier2Pct',
    labelKey: 'referrals.tier2Label',
  },
  {
    tier: 3,
    icon: Users,
    accent:
      'from-[color-mix(in_oklch,var(--color-foreground)_10%,transparent)] to-transparent ring-border',
    pctKey: 'referrals.tier3Pct',
    labelKey: 'referrals.tier3Label',
  },
];

export function ReferralStatsGrid({ stats, isLoading }: Props) {
  const t = useTranslations('social');

  return (
    <section aria-labelledby="ref-stats-heading" className="flex flex-col gap-3">
      <header className="flex items-end justify-between gap-3">
        <h2 id="ref-stats-heading" className="font-display text-lg font-semibold sm:text-xl">
          {t('referrals.statsTitle')}
        </h2>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Coins className="h-4 w-4 text-[var(--color-neon-cyan)]" aria-hidden="true" />
          <span>{t('referrals.totalEarned')}:</span>
          <span className="font-semibold text-foreground tabular-nums">
            {isLoading ? '…' : (stats?.totalEarned ?? 0).toLocaleString()}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TIER_VISUALS.map((v) => {
          const tierStats =
            v.tier === 1 ? stats?.tier1 : v.tier === 2 ? stats?.tier2 : stats?.tier3;
          return (
            <article
              key={v.tier}
              className={cn(
                'group relative overflow-hidden rounded-2xl border border-border/70 bg-card/60 p-5 ring-1',
                v.accent.split(' ').filter((c) => c.startsWith('ring-')).join(' '),
              )}
            >
              <div
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br',
                  v.accent.split(' ').filter((c) => !c.startsWith('ring-')).join(' '),
                )}
              />
              <header className="mb-3 flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <v.icon className="h-4 w-4" aria-hidden="true" />
                  {t('referrals.tierBadge', { tier: v.tier })}
                </span>
                <span className="font-display text-2xl font-bold text-foreground">
                  {t(v.pctKey)}
                </span>
              </header>
              <p className="mb-3 text-sm font-medium text-foreground">{t(v.labelKey)}</p>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">{t('referrals.downlineTitle')}</dt>
                  <dd className="font-semibold tabular-nums">
                    {isLoading
                      ? '…'
                      : t('referrals.tierCount', { count: tierStats?.count ?? 0 })}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('referrals.totalEarned')}</dt>
                  <dd className="font-semibold tabular-nums text-[var(--color-neon-cyan)]">
                    {isLoading
                      ? '…'
                      : t('referrals.tierEarned', {
                          coins: (tierStats?.earnedCoins ?? 0).toLocaleString(),
                        })}
                  </dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}
