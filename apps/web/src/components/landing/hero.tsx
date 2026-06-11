/**
 * Landing — Hero section.
 *
 * Server component. The SOLE H1 of the document lives here and paints at its
 * final visible state from the initial HTML — no `landing-rise`, no opacity:0
 * gate — so the LCP element is on screen the moment HTML reaches the browser.
 *
 * Two CTAs as the brief requires:
 *   • Primary  → `/register`  (signup is the funnel goal)
 *   • Secondary → `/login`    (returning users)
 *
 * Both are real `<a>` (next/link) elements — no `role="button"` cosplay.
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowRight, Globe2, LogIn, ShieldCheck, Zap } from 'lucide-react';
import { TopMarquee } from '@/components/top-marquee';
import { cn } from '@/lib/cn';

const TRUST = [
  { icon: Zap, key: 'instant' },
  { icon: ShieldCheck, key: 'moderation' },
  { icon: Globe2, key: 'global' },
] as const;

const STAT_KEYS = ['countries', 'connect', 'live'] as const;

export async function LandingHero() {
  const t = await getTranslations('landing');

  return (
    <section
      aria-labelledby="landing-hero-title"
      className="relative mx-auto max-w-7xl px-4 pb-12 pt-16 sm:px-6 sm:pt-24 lg:px-8"
    >
      <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <p className="glass-panel inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-neon-cyan)] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-neon-cyan)]" />
            </span>
            {t('liveBadge')}
          </p>

          {/* LCP element — painted at the final visible state, no entrance
              animation, no opacity:0 wait. The ONLY h1 on the page. */}
          <h1
            id="landing-hero-title"
            className="mt-6 font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl"
          >
            {t('headline1')}
            <br />
            <span className="text-gradient-neon">{t('headline2')}</span>
          </h1>

          <p className="mt-6 max-w-xl text-balance text-lg text-muted-foreground">
            {t('subheading')}
          </p>

          {/* Primary funnel: signup is the conversion goal; login is the */}
          {/* secondary path for returning users. */}
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/register"
              className={cn(
                'group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl px-7 py-3.5',
                'text-base font-semibold text-primary-foreground',
                'bg-gradient-to-r from-[var(--color-neon-violet)] via-[var(--color-neon-magenta)] to-[var(--color-neon-violet)] bg-[length:200%_100%] bg-left',
                'shadow-[0_8px_30px_-8px_var(--color-neon-violet)] transition-[background-position,transform] duration-500',
                'hover:bg-right hover:-translate-y-0.5 active:translate-y-0',
              )}
            >
              {t('ctaStart')}
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </Link>
            <Link
              href="/login"
              className={cn(
                'inline-flex items-center justify-center gap-2 rounded-xl px-7 py-3.5 text-base font-semibold',
                'glass-panel text-foreground transition-colors hover:bg-card/80',
              )}
            >
              <LogIn className="h-5 w-5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
              {t('ctaSecondary')}
            </Link>
          </div>

          {/* Trust row */}
          <ul className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
            {TRUST.map(({ icon: Icon, key }) => (
              <li key={key} className="inline-flex items-center gap-2">
                <Icon className="h-4 w-4 text-[var(--color-neon-violet)]" aria-hidden="true" />
                {t(`trust.${key}`)}
              </li>
            ))}
          </ul>
        </div>

        {/* Top marquee teaser — only client island in the hero. */}
        <div className="relative">
          <div className="glass-panel overflow-hidden rounded-3xl p-4">
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="font-display text-sm font-bold">{t('topTeaser.title')}</span>
              <Link
                href="/top"
                className="text-xs font-medium text-[var(--color-neon-cyan)] transition-colors hover:text-foreground"
              >
                {t('topTeaser.viewAll')}
              </Link>
            </div>
            <TopMarquee />
          </div>
          <div
            aria-hidden="true"
            className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-[var(--color-neon-violet)]/20 via-transparent to-[var(--color-neon-cyan)]/20 blur-2xl"
          />
        </div>
      </div>

      {/* Stats strip */}
      <ul
        aria-label={t('liveBadge')}
        className="glass-panel mt-16 grid grid-cols-1 divide-y divide-border/60 rounded-2xl sm:grid-cols-3 sm:divide-x sm:divide-y-0"
      >
        {STAT_KEYS.map((key) => (
          <li key={key} className="flex flex-col items-center gap-1 px-6 py-6">
            <span className="font-display text-3xl font-bold text-gradient-neon">
              {t(`stats.${key}.value`)}
            </span>
            <span className="text-sm text-muted-foreground">{t(`stats.${key}.label`)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
