'use client';

/**
 * Top-level client for `/referrals` — orchestrates the four panels:
 *
 *   1. Link hero card with code + share buttons (VK / Telegram / clipboard).
 *   2. Per-tier stats grid (T1/T2/T3 + total).
 *   3. "How it works" explainer.
 *   4. Tabbed downline list (T1/T2/T3) with cursor pagination.
 *
 * Gated on auth at the call site — signed-out visitors see a soft sign-in CTA
 * (the page route is public so SEO can still index the explainer, but private
 * data + the share link materialise only after auth lands).
 */
import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Loader2, ShieldCheck, Sparkles } from 'lucide-react';

import type { ReferralTier } from '@ruletka/shared-types';

import { useAuth } from '@/features/auth/use-auth';
import { ROUTES } from '@/config/nav';
import { ReferralLinkCard } from './referral-link-card';
import { ReferralStatsGrid } from './referral-stats-grid';
import { ReferralExplainer } from './referral-explainer';
import { ReferralDownlineList } from './referral-downline-list';
import { useReferralMe } from './use-referrals';

export function ReferralsClient() {
  const t = useTranslations('social');
  const { isAuthenticated, isReady } = useAuth();
  const meQuery = useReferralMe({ enabled: isAuthenticated });
  const [activeTier, setActiveTier] = useState<ReferralTier>(1);

  // Boot — auth still settling. Show a neutral spinner so the page doesn't
  // flash the sign-in CTA for a signed-in user mid-rehydrate.
  if (!isReady) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="rounded-2xl border border-border/70 bg-card/60 p-6 text-center sm:p-8">
        <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-card/80 text-[var(--color-neon-violet)] ring-1 ring-border/70">
          <ShieldCheck className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="font-display text-xl font-bold">{t('referrals.signInTitle')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('referrals.signInDescription')}
        </p>
        <Link
          href={ROUTES.home}
          className="mt-5 inline-flex items-center gap-2 rounded-full border border-border/70 bg-gradient-to-b from-card/80 to-card/40 px-4 py-2 text-sm font-medium hover:bg-card/80"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {t('referrals.eyebrow')}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Link + share hero. */}
      <ReferralLinkCard data={meQuery.data} isLoading={meQuery.isLoading} />

      {/* Per-tier stats. */}
      <ReferralStatsGrid stats={meQuery.data?.stats} isLoading={meQuery.isLoading} />

      {/* "How it works" — sits between the stats and the (longer) downline list so
          a new visitor reads the rules before scanning who has signed up. */}
      <ReferralExplainer />

      {/* Downline list with tier tabs. */}
      <ReferralDownlineList activeTier={activeTier} onTierChange={setActiveTier} />
    </div>
  );
}
