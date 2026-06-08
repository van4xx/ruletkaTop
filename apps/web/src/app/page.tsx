/**
 * Landing / home page for ruletka.top.
 *
 * Dark-first, atmospheric hero with layered gradient glows + grain, a neon
 * gradient headline, primary CTA to the video roulette, a live-feel teaser of
 * the two-direction Top marquee, a trust/stats strip and feature cards.
 *
 * SERVER COMPONENT: the whole marketing tree is static server HTML — the LCP
 * headline (`landing.headline1/2`), subheading, CTAs and trust row paint at
 * their final visible state with NO client JS and NO opacity:0-until-hydration
 * delay. The former framer-motion staggered entrance is replaced by the CSS
 * `.landing-rise` utility (globals.css), which respects `prefers-reduced-motion`
 * via the global reduced-motion rule. The only client island is `TopMarquee`
 * (its own `'use client'`). All copy is localized via next-intl (`landing` +
 * `common`) using the server `getTranslations` API.
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowRight, Globe2, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { FEATURE_HIGHLIGHTS, ROUTES } from '@/config/nav';
import { TopMarquee } from '@/components/top-marquee';
import { JsonLdScript } from '@/components/json-ld';
import { webApplicationLd } from '@/lib/json-ld';
import { cn } from '@/lib/cn';

/** Stat keys — values + labels live in the `landing.stats.*` messages. */
const STAT_KEYS = ['countries', 'connect', 'live'] as const;

/** Trust row — icon + key into the `landing.trust.*` messages. */
const TRUST = [
  { icon: Zap, key: 'instant' },
  { icon: ShieldCheck, key: 'moderation' },
  { icon: Globe2, key: 'global' },
] as const;

export default async function HomePage() {
  const t = await getTranslations('landing');
  const tc = await getTranslations('common');

  return (
    <div className="grain relative overflow-hidden">
      {/* Landing-specific structured data: WebApplication (social roulette). The
          site-wide Organization + WebSite nodes live in the root layout. */}
      <JsonLdScript data={webApplicationLd(t('headline1'), t('subheading'))} />

      {/* ── Atmospheric background ───────────────────────────────────── */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        {/* Layered neon glows. */}
        <div className="absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--color-neon-violet)_0%,transparent_60%)] opacity-25 blur-3xl" />
        <div className="absolute -right-24 top-32 h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-magenta)_0%,transparent_60%)] opacity-20 blur-3xl" />
        <div className="absolute -left-24 top-64 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan)_0%,transparent_60%)] opacity-20 blur-3xl" />
        {/* Faint grid for tech texture. */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:64px_64px] opacity-[0.15] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      </div>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 pb-12 pt-16 sm:px-6 sm:pt-24 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="landing-rise">
              <span className="glass-panel inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-neon-cyan)] opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-neon-cyan)]" />
                </span>
                {t('liveBadge')}
              </span>
            </div>

            {/* LCP headline — painted at its final visible state (no entrance
                animation) so it never waits on hydration. */}
            <h1 className="mt-6 font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
              {t('headline1')}
              <br />
              <span className="text-gradient-neon">{t('headline2')}</span>
            </h1>

            <p
              className="landing-rise mt-6 max-w-xl text-balance text-lg text-muted-foreground"
              style={{ '--rise-delay': '80ms' } as React.CSSProperties}
            >
              {t('subheading')}
            </p>

            <div
              className="landing-rise mt-9 flex flex-col gap-3 sm:flex-row"
              style={{ '--rise-delay': '160ms' } as React.CSSProperties}
            >
              <Link
                href={ROUTES.video}
                className={cn(
                  'group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl px-7 py-3.5',
                  'text-base font-semibold text-primary-foreground',
                  'bg-gradient-to-r from-[var(--color-neon-violet)] via-[var(--color-neon-magenta)] to-[var(--color-neon-violet)] bg-[length:200%_100%] bg-left',
                  'shadow-[0_8px_30px_-8px_var(--color-neon-violet)] transition-[background-position,transform] duration-500',
                  'hover:bg-right hover:-translate-y-0.5 active:translate-y-0',
                )}
              >
                {t('ctaStart')}
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href={ROUTES.voice}
                className={cn(
                  'inline-flex items-center justify-center gap-2 rounded-xl px-7 py-3.5 text-base font-semibold',
                  'glass-panel text-foreground transition-colors hover:bg-card/80',
                )}
              >
                <Sparkles className="h-5 w-5 text-[var(--color-neon-cyan)]" />
                {t('ctaVoice')}
              </Link>
            </div>

            {/* Trust row */}
            <ul
              className="landing-rise mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground"
              style={{ '--rise-delay': '240ms' } as React.CSSProperties}
            >
              {TRUST.map(({ icon: Icon, key }) => (
                <li key={key} className="inline-flex items-center gap-2">
                  <Icon className="h-4 w-4 text-[var(--color-neon-violet)]" aria-hidden="true" />
                  {t(`trust.${key}`)}
                </li>
              ))}
            </ul>
          </div>

          {/* Top marquee teaser */}
          <div
            className="landing-rise relative"
            style={{ '--rise-delay': '200ms' } as React.CSSProperties}
          >
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
            {/* Glow behind the panel. */}
            <div
              aria-hidden="true"
              className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-[var(--color-neon-violet)]/20 via-transparent to-[var(--color-neon-cyan)]/20 blur-2xl"
            />
          </div>
        </div>

        {/* Stats strip */}
        <div className="landing-rise glass-panel mt-16 grid grid-cols-1 divide-y divide-border/60 rounded-2xl sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {STAT_KEYS.map((key) => (
            <div key={key} className="flex flex-col items-center gap-1 px-6 py-6">
              <span className="font-display text-3xl font-bold text-gradient-neon">
                {t(`stats.${key}.value`)}
              </span>
              <span className="text-sm text-muted-foreground">{t(`stats.${key}.label`)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {t('features.title')}
          </h2>
          <p className="mt-4 text-muted-foreground">{t('features.subtitle')}</p>
        </div>

        {/* The cards are always visible: each plays a one-shot CSS fade-up on
            load (staggered), and `prefers-reduced-motion` snaps them to their
            final state. Replaces the prior `animate="show"` framer-motion grid. */}
        <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURE_HIGHLIGHTS.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <li
                key={feature.key}
                className="landing-rise"
                style={{ '--rise-delay': `${i * 80}ms` } as React.CSSProperties}
              >
                <Link
                  href={feature.href}
                  className="group relative block h-full overflow-hidden rounded-2xl"
                >
                  {/* Accent glow that intensifies on hover. */}
                  <div
                    aria-hidden="true"
                    className={cn(
                      'absolute inset-0 bg-gradient-to-br opacity-60 transition-opacity duration-300 group-hover:opacity-100',
                      feature.accent,
                    )}
                  />
                  <div className="glass-panel relative flex h-full flex-col gap-4 rounded-2xl p-6">
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-card/70 text-foreground ring-1 ring-border/70">
                      <Icon className="h-6 w-6" aria-hidden="true" />
                    </span>
                    <div className="space-y-2">
                      <h3 className="font-display text-lg font-bold">
                        {t(`features.${feature.key}.title`)}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {t(`features.${feature.key}.description`)}
                      </p>
                    </div>
                    <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-foreground/80 transition-colors group-hover:text-foreground">
                      {tc('learnMore')}
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8">
        <div className="landing-rise relative overflow-hidden rounded-3xl px-6 py-14 text-center sm:px-12">
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-gradient-to-br from-[var(--color-neon-violet)]/25 via-card to-[var(--color-neon-cyan)]/20"
          />
          <div className="glass-panel absolute inset-0 -z-10 rounded-3xl" aria-hidden="true" />
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {t('finalCta.title')}
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-muted-foreground">{t('finalCta.subtitle')}</p>
          <Link
            href={ROUTES.video}
            className={cn(
              'group mt-8 inline-flex items-center justify-center gap-2 rounded-xl px-8 py-4',
              'text-base font-semibold text-primary-foreground',
              'bg-gradient-to-r from-[var(--color-neon-violet)] via-[var(--color-neon-magenta)] to-[var(--color-neon-violet)] bg-[length:200%_100%] bg-left',
              'shadow-[0_8px_30px_-8px_var(--color-neon-violet)] transition-[background-position,transform] duration-500',
              'hover:bg-right hover:-translate-y-0.5 active:translate-y-0',
            )}
          >
            {t('finalCta.button')}
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </section>
    </div>
  );
}
