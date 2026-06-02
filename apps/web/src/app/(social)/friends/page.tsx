import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { Users } from 'lucide-react';
import { FriendsClient } from '@/features/friends/friends-client';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('social');
  return {
    title: t('friendsMetaTitle'),
    description: t('friendsMetaDescription'),
  };
}

/**
 * /friends — the social hub. A static, atmospheric header (server-rendered)
 * wraps the interactive {@link FriendsClient}, which owns the live data,
 * presence and mutations.
 */
export default function FriendsPage() {
  const t = useTranslations('social');
  return (
    <div className="relative overflow-hidden">
      {/* Ambient neon glows, consistent with the landing aesthetic. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/4 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--color-neon-violet)_0%,transparent_60%)] opacity-[0.18] blur-3xl" />
        <div className="absolute -right-20 top-20 h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan)_0%,transparent_60%)] opacity-[0.14] blur-3xl" />
      </div>

      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
        <header className="mb-8 flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-card/70 text-[var(--color-neon-violet)] ring-1 ring-border/70">
            <Users className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
              {t('friendsHeading')}
            </h1>
            <p className="text-sm text-muted-foreground">{t('friendsSubtitle')}</p>
          </div>
        </header>

        <FriendsClient />
      </div>
    </div>
  );
}
