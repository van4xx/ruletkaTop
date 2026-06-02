'use client';

/**
 * The dashboard's primary call-to-action: two large, exciting cards that start
 * the video or voice roulette. Each has a prominent gradient/neon treatment,
 * an animated "live" pulse, hover motion (lift + sweep + arrow), and a small
 * inline "Фильтры" affordance that opens the matchmaking filters modal (falling
 * back to the route when the modal system isn't wired).
 */
import Link from 'next/link';
import { motion, type Variants } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { ArrowRight, Mic, SlidersHorizontal, Video } from 'lucide-react';
import { ROUTES } from '@/config/nav';
import { cn } from '@/lib/cn';
import { MODAL, useAppModals } from '@/hooks/dashboard/use-app-modals';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

const grid: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
};

const card: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.6, ease: EASE_OUT } },
};

interface LaunchConfig {
  mode: 'video' | 'voice';
  href: string;
  icon: typeof Video;
  /** `misc.dashboard.*` key for the card title. */
  titleKey: string;
  /** `misc.dashboard.*` key for the card subtitle. */
  subtitleKey: string;
  /** Tailwind gradient stops for the card's living glow. */
  gradient: string;
  /** Accent variable used for the icon halo + sweep. */
  accent: string;
}

const LAUNCH: readonly LaunchConfig[] = [
  {
    mode: 'video',
    href: ROUTES.video,
    icon: Video,
    titleKey: 'dashboard.quickLaunchVideoTitle',
    subtitleKey: 'dashboard.quickLaunchVideoSubtitle',
    gradient: 'from-[var(--color-neon-violet)]/35 via-[var(--color-neon-magenta)]/20 to-transparent',
    accent: 'var(--color-neon-violet)',
  },
  {
    mode: 'voice',
    href: ROUTES.voice,
    icon: Mic,
    titleKey: 'dashboard.quickLaunchVoiceTitle',
    subtitleKey: 'dashboard.quickLaunchVoiceSubtitle',
    gradient: 'from-[var(--color-neon-cyan)]/35 via-[color-mix(in_oklch,var(--color-neon-cyan)_60%,var(--color-neon-violet))]/15 to-transparent',
    accent: 'var(--color-neon-cyan)',
  },
] as const;

function LaunchCard({ config }: { config: LaunchConfig }) {
  const t = useTranslations('misc');
  const modals = useAppModals();
  const Icon = config.icon;
  const title = t(config.titleKey);

  return (
    <motion.div variants={card} className="relative">
      <Link
        href={config.href}
        className={cn(
          'group relative block h-full overflow-hidden rounded-3xl',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
        aria-label={t('dashboard.launchStartAria', { title })}
      >
        {/* Living gradient wash that intensifies on hover. */}
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-0 bg-gradient-to-br opacity-70 transition-opacity duration-500 group-hover:opacity-100',
            config.gradient,
          )}
        />
        {/* Diagonal light sweep on hover. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-x-1 -top-1/2 h-[200%] -translate-x-[120%] -rotate-12 bg-gradient-to-r from-transparent via-foreground/10 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-[120%]"
        />

        <div className="glass-panel relative flex h-full min-h-[11rem] flex-col justify-between gap-6 rounded-3xl border-0 p-6 sm:min-h-[13rem] sm:p-7">
          <div className="flex items-start justify-between gap-3">
            {/* Icon with a soft neon halo + idle float. */}
            <span className="relative inline-flex">
              <span
                aria-hidden="true"
                className="absolute inset-0 -z-10 rounded-2xl blur-lg transition-opacity duration-500 group-hover:opacity-90"
                style={{ backgroundColor: config.accent, opacity: 0.5 }}
              />
              <motion.span
                className="inline-flex h-13 w-13 items-center justify-center rounded-2xl bg-background/70 text-foreground ring-1 ring-border/70 sm:h-14 sm:w-14"
                whileHover={{ rotate: -6, scale: 1.05 }}
                transition={{ type: 'spring', stiffness: 320, damping: 18 }}
              >
                <Icon className="h-6 w-6 sm:h-7 sm:w-7" style={{ color: config.accent }} aria-hidden="true" />
              </motion.span>
            </span>

            {/* Live-pulse chip. */}
            <span className="glass-panel inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold text-muted-foreground">
              <span className="relative flex h-1.5 w-1.5">
                <span
                  className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                  style={{ backgroundColor: config.accent }}
                />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: config.accent }} />
              </span>
              {t('dashboard.onAir')}
            </span>
          </div>

          {/* Right padding leaves room for the absolutely-positioned Фильтры pill. */}
          <div className="pr-24">
            <h3 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
              {title}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{t(config.subtitleKey)}</p>

            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
              {t('dashboard.start')}
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1.5" />
            </span>
          </div>
        </div>
      </Link>

      {/* "Фильтры" affordance — a sibling control (not nested in the link). */}
      <button
        type="button"
        onClick={() => modals.open(MODAL.filters, { fallback: config.href })}
        className={cn(
          'absolute bottom-5 right-5 sm:bottom-6 sm:right-6',
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium',
          'border border-border/70 bg-background/60 text-foreground/90 backdrop-blur',
          'transition-colors hover:bg-background/90 hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
        aria-label={t('dashboard.filtersForModeAria', { title })}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        {t('dashboard.filters')}
      </button>
    </motion.div>
  );
}

export function QuickLaunch() {
  return (
    <motion.div
      variants={grid}
      initial="hidden"
      animate="show"
      className="grid gap-4 sm:grid-cols-2 sm:gap-5"
    >
      {LAUNCH.map((config) => (
        <LaunchCard key={config.mode} config={config} />
      ))}
    </motion.div>
  );
}
