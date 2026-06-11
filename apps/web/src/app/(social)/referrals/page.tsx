import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { Share2 } from 'lucide-react';

import { ReferralsClient } from '@/features/referrals/referrals-client';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('social');
  return {
    title: t('referrals.metaTitle'),
    description: t('referrals.metaDescription'),
  };
}

/**
 * /referrals — server-rendered atmospheric header wraps the interactive
 * {@link ReferralsClient}, which owns the live link + downline data + share
 * intents. Mirrors the layout of /friends so the social hub feels cohesive.
 */
export default function ReferralsPage() {
  const t = useTranslations('social');
  return (
    <div className="relative overflow-hidden">
      {/* Ambient neon glows, consistent with the landing aesthetic. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/4 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--color-neon-violet)_0%,transparent_60%)] opacity-[0.18] blur-3xl" />
        <div className="absolute -right-20 top-20 h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan)_0%,transparent_60%)] opacity-[0.14] blur-3xl" />
      </div>

      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
        <header className="mb-8 flex items-start gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-card/70 text-[var(--color-neon-violet)] ring-1 ring-border/70">
            <Share2 className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {t('referrals.eyebrow')}
            </p>
            <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
              {t('referrals.titlePrefix')}{' '}
              <span className="bg-gradient-to-r from-[var(--color-neon-violet)] to-[var(--color-neon-cyan)] bg-clip-text text-transparent">
                {t('referrals.titleAccent')}
              </span>
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground sm:text-base">
              {t('referrals.lede')}
            </p>
          </div>
        </header>

        <ReferralsClient />
      </div>
    </div>
  );
}
