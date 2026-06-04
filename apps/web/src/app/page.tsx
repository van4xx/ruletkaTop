'use client';

/**
 * Landing / home page for ruletka.top.
 *
 * Dark-first, atmospheric hero with layered gradient glows + grain, a neon
 * gradient headline, primary CTA to the video roulette, a live-feel teaser of
 * the two-direction Top marquee, a trust/stats strip and feature cards.
 *
 * Motion: a single, well-orchestrated staggered entrance (framer-motion). All
 * looping/long animations are neutralised under `prefers-reduced-motion` via
 * globals.css. All copy is localized via next-intl (`landing` + `common`).
 */
import Link from 'next/link';
import { motion, type Variants } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { ArrowRight, Globe2, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { FEATURE_HIGHLIGHTS, ROUTES } from '@/config/nav';
import { TopMarquee } from '@/components/top-marquee';
import { JsonLdScript } from '@/components/json-ld';
import { webApplicationLd } from '@/lib/json-ld';
import { cn } from '@/lib/cn';

/** Shared "ease-out expo" curve as a typed bezier tuple (not widened to number[]). */
const EASE_OUT = [0.16, 1, 0.3, 1] as const;

const container: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

const rise: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: EASE_OUT },
  },
};

/** Stat keys — values + labels live in the `landing.stats.*` messages. */
const STAT_KEYS = ['countries', 'connect', 'live'] as const;

/** Trust row — icon + key into the `landing.trust.*` messages. */
const TRUST = [
  { icon: Zap, key: 'instant' },
  { icon: ShieldCheck, key: 'moderation' },
  { icon: Globe2, key: 'global' },
] as const;

export default function HomePage() {
  const t = useTranslations('landing');
  const tc = useTranslations('common');

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
          <motion.div variants={container} initial="hidden" animate="show">
            <motion.div variants={rise}>
              <span className="glass-panel inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-neon-cyan)] opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-neon-cyan)]" />
                </span>
                {t('liveBadge')}
              </span>
            </motion.div>

            <motion.h1
              variants={rise}
              className="mt-6 font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl"
            >
              {t('headline1')}
              <br />
              <span className="text-gradient-neon">{t('headline2')}</span>
            </motion.h1>

            <motion.p
              variants={rise}
              className="mt-6 max-w-xl text-balance text-lg text-muted-foreground"
            >
              {t('subheading')}
            </motion.p>

            <motion.div variants={rise} className="mt-9 flex flex-col gap-3 sm:flex-row">
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
            </motion.div>

            {/* Trust row */}
            <motion.ul
              variants={rise}
              className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground"
            >
              {TRUST.map(({ icon: Icon, key }) => (
                <li key={key} className="inline-flex items-center gap-2">
                  <Icon className="h-4 w-4 text-[var(--color-neon-violet)]" aria-hidden="true" />
                  {t(`trust.${key}`)}
                </li>
              ))}
            </motion.ul>
          </motion.div>

          {/* Top marquee teaser */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: EASE_OUT, delay: 0.2 }}
            className="relative"
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
          </motion.div>
        </div>

        {/* Stats strip */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          className="glass-panel mt-16 grid grid-cols-1 divide-y divide-border/60 rounded-2xl sm:grid-cols-3 sm:divide-x sm:divide-y-0"
        >
          {STAT_KEYS.map((key) => (
            <div key={key} className="flex flex-col items-center gap-1 px-6 py-6">
              <span className="font-display text-3xl font-bold text-gradient-neon">
                {t(`stats.${key}.value`)}
              </span>
              <span className="text-sm text-muted-foreground">{t(`stats.${key}.label`)}</span>
            </div>
          ))}
        </motion.div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {t('features.title')}
          </h2>
          <p className="mt-4 text-muted-foreground">{t('features.subtitle')}</p>
        </div>

        <motion.ul
          variants={container}
          initial="hidden"
          // Animate the staggered reveal on mount rather than on scroll-into-view.
          // The previous `whileInView` left the grid stuck at opacity:0 whenever
          // its IntersectionObserver didn't fire (e.g. the section was already
          // on-screen at load) — which read as an empty gap, most visibly in the
          // light theme where the faint accent glow behind the cards is barely
          // perceptible. `animate="show"` guarantees the cards are always shown.
          animate="show"
          className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {FEATURE_HIGHLIGHTS.map((feature) => {
            const Icon = feature.icon;
            return (
              <motion.li key={feature.key} variants={rise}>
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
              </motion.li>
            );
          })}
        </motion.ul>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          className="relative overflow-hidden rounded-3xl px-6 py-14 text-center sm:px-12"
        >
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
        </motion.div>
      </section>
    </div>
  );
}
