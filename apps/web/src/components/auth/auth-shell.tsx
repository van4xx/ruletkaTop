'use client';

/**
 * Split-screen shell for the auth pages.
 *
 * Left (lg+ only): an atmospheric brand panel — layered neon aurora glows,
 * grain, the rotating "roulette" emblem, a one-line value prop and a vertical
 * marquee of social-proof pills, echoing the landing page's "Top эфира" teaser.
 * Right: the form, vertically centered, on the app's void canvas.
 *
 * On mobile the brand panel collapses to a compact header so the form leads.
 */
import Link from 'next/link';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { ROUTES } from '@/config/nav';
import { cn } from '@/lib/cn';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Social-proof pill keys — copy lives in `auth.shell.proof.*`. */
const PROOF_KEYS = ['countries', 'connect', 'moderation', 'gifts', 'premium', 'noAds'] as const;

/** Perk rows — icon + key into `auth.shell.perks.*`. */
const PERKS = [
  { icon: Zap, key: 'instant' },
  { icon: ShieldCheck, key: 'secure' },
  { icon: Sparkles, key: 'live' },
] as const;

function RouletteEmblem() {
  return (
    <span className="relative inline-flex h-12 w-12 items-center justify-center">
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full bg-[conic-gradient(from_140deg,var(--color-neon-violet),var(--color-neon-magenta),var(--color-neon-cyan),var(--color-neon-violet))] opacity-90 blur-[1px] [animation:spin_8s_linear_infinite]"
      />
      <span aria-hidden="true" className="absolute inset-[4px] rounded-full bg-background" />
      <span
        aria-hidden="true"
        className="relative h-2.5 w-2.5 rounded-full bg-[var(--color-neon-cyan)] shadow-[0_0_12px_var(--color-neon-cyan)]"
      />
    </span>
  );
}

/** Seamless vertical marquee of social-proof pills (duplicated for the loop). */
function ProofMarquee() {
  const t = useTranslations('auth');
  const reduce = useReducedMotion();
  const items = [...PROOF_KEYS, ...PROOF_KEYS];
  return (
    <div className="relative h-64 overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_12%,black_88%,transparent)]">
      <div
        className={cn('flex flex-col gap-3', !reduce && '[animation:marquee-up_22s_linear_infinite]')}
      >
        {items.map((key, i) => (
          <span
            key={`${key}-${i}`}
            className="glass-panel inline-flex items-center gap-2 self-start rounded-full px-4 py-2 text-sm text-foreground/90"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-neon-cyan)]" aria-hidden="true" />
            {t(`shell.proof.${key}`)}
          </span>
        ))}
      </div>
    </div>
  );
}

const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
};

export interface AuthShellProps {
  /** Form column. */
  children: React.ReactNode;
  /** Headline shown above the brand marquee on large screens. */
  pitch?: string;
}

export function AuthShell({ children, pitch }: AuthShellProps) {
  const t = useTranslations('auth');
  const headline = pitch ?? t('shell.pitch.default');
  return (
    <div className="grain relative min-h-[calc(100dvh-4rem)] overflow-hidden">
      {/* Atmospheric background — confined to the brand side on lg+. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-32 -top-32 h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-violet)_0%,transparent_60%)] opacity-25 blur-3xl" />
        <div className="absolute -bottom-24 left-1/4 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-magenta)_0%,transparent_60%)] opacity-20 blur-3xl" />
        <div className="absolute right-1/4 top-1/3 h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan)_0%,transparent_60%)] opacity-[0.18] blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:64px_64px] opacity-[0.12] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      </div>

      <div className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-7xl grid-cols-1 items-stretch gap-0 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
        {/* ── Brand panel (lg+) ── */}
        <motion.aside
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.09 } } }}
          className="relative hidden flex-col justify-center py-12 pr-12 lg:flex"
        >
          <motion.div variants={rise}>
            <Link
              href={ROUTES.home}
              className="inline-flex items-center gap-3 rounded-lg"
              aria-label={t('shell.homeAria')}
            >
              <RouletteEmblem />
              <span className="font-display text-2xl font-bold leading-none tracking-tight">
                ruletka<span className="text-gradient-neon">.top</span>
              </span>
            </Link>
          </motion.div>

          <motion.h2
            variants={rise}
            className="mt-10 max-w-md font-display text-4xl font-extrabold leading-[1.08] tracking-tight"
          >
            {headline}
          </motion.h2>

          <motion.ul variants={rise} className="mt-6 flex flex-col gap-3">
            {PERKS.map(({ icon: Icon, key }) => (
              <li key={key} className="inline-flex items-center gap-3 text-muted-foreground">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg glass-panel">
                  <Icon className="h-4 w-4 text-[var(--color-neon-violet)]" aria-hidden="true" />
                </span>
                {t(`shell.perks.${key}`)}
              </li>
            ))}
          </motion.ul>

          <motion.div variants={rise} className="mt-10 max-w-xs">
            <ProofMarquee />
          </motion.div>
        </motion.aside>

        {/* ── Form panel ── */}
        <div className="flex flex-col justify-center py-10 sm:py-14 lg:pl-12">
          {/* Compact brand header for mobile / tablet. */}
          <Link
            href={ROUTES.home}
            className="mb-8 inline-flex items-center gap-2.5 self-center rounded-lg lg:hidden"
            aria-label={t('shell.homeAria')}
          >
            <RouletteEmblem />
            <span className="font-display text-xl font-bold leading-none tracking-tight">
              ruletka<span className="text-gradient-neon">.top</span>
            </span>
          </Link>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: EASE_OUT }}
            className="mx-auto w-full max-w-md"
          >
            {children}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
