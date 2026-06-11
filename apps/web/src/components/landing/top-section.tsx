/**
 * Landing — "Top stars on air today" section.
 *
 * Server component wrapper around the existing `TopMarquee` client island.
 * Adds the semantic H2 + descriptive lede the brief requires so this stops
 * being a decoration with no SEO body and starts paying its way as a content
 * section. The marquee itself stays the only client JS in this section.
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Trophy } from 'lucide-react';
import { ROUTES } from '@/config/nav';
import { TopMarquee } from '@/components/top-marquee';

export async function LandingTopSection() {
  const t = await getTranslations('landing');

  return (
    <section
      aria-labelledby="landing-top"
      className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-3xl text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-border/60 px-3 py-1 text-xs font-medium text-muted-foreground">
          <Trophy className="h-3.5 w-3.5 text-[var(--color-neon-magenta)]" aria-hidden="true" />
          24h
        </span>
        <h2
          id="landing-top"
          className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl"
        >
          {t('topSection.title')}
        </h2>
        <p className="mt-3 text-balance text-muted-foreground">{t('topSection.lede')}</p>
      </div>

      <div className="relative mx-auto mt-10 max-w-3xl">
        <div className="glass-panel overflow-hidden rounded-3xl p-4">
          <div className="mb-3 flex items-center justify-between px-1">
            <span className="font-display text-sm font-bold">{t('topTeaser.title')}</span>
            <Link
              href={ROUTES.top}
              className="text-xs font-medium text-[var(--color-neon-cyan)] transition-colors hover:text-foreground"
            >
              {t('topTeaser.viewAll')}
            </Link>
          </div>
          <TopMarquee />
        </div>
        <div
          aria-hidden="true"
          className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-[var(--color-neon-magenta)]/20 via-transparent to-[var(--color-neon-violet)]/20 blur-2xl"
        />
      </div>
    </section>
  );
}
