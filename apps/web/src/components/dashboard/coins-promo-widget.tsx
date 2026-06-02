'use client';

/**
 * Daily-bonus / coins promo — a vibrant, gradient "earn & spend coins" card.
 * It anchors the economy CTAs on the dashboard: a primary "Пополнить" (opens the
 * buy-coins modal, fallback /coins) and a secondary link to Premium perks.
 *
 * A lightweight "daily bonus" streak strip is presented as an aspirational
 * teaser (7-day ladder). There is no daily-bonus endpoint yet, so the claim CTA
 * routes to /coins; see the integrator note below.
 *
 * INTEGRATOR / BACKEND NOTE: a real daily bonus needs an endpoint pair, e.g.
 *   GET  /economy/daily-bonus  → { streak, claimedToday, nextRewardCoins, ... }
 *   POST /economy/daily-bonus/claim → credits coins + advances the streak
 * Wire those to make the ladder live and the button actually claim.
 */
import Link from 'next/link';
import { motion, type Variants } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Coins, Gift, Plus, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { MODAL, useAppModals } from '@/hooks/dashboard/use-app-modals';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const COINS_ROUTE = '/coins';
const PREMIUM_ROUTE = '/premium';

/** Aspirational 7-day reward ladder (static teaser until the API lands). */
const LADDER = [10, 15, 20, 30, 45, 70, 120] as const;

/** Quick left-to-right "climb" as the rungs settle in. */
const ladder: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.15 } },
};

const rung: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.9 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: EASE_OUT } },
};

export function CoinsPromoWidget() {
  const t = useTranslations('misc');
  const modals = useAppModals();

  return (
    <motion.section
      aria-label={t('dashboard.coinsPromoLabel')}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: EASE_OUT }}
      className="relative overflow-hidden rounded-3xl"
    >
      {/* Rich layered gradient + glow. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-br from-[color-mix(in_oklch,var(--warning)_30%,transparent)] via-[var(--color-neon-magenta)]/20 to-[var(--color-neon-violet)]/30"
      />
      <div
        aria-hidden="true"
        className="absolute -right-10 -top-10 -z-10 h-40 w-40 rounded-full bg-[radial-gradient(circle,var(--warning)_0%,transparent_70%)] opacity-40 blur-2xl"
      />
      <div className="glass-panel absolute inset-0 -z-10 rounded-3xl border-0" aria-hidden="true" />

      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-background/60 text-warning ring-1 ring-border/70">
              <Gift className="h-5 w-5" aria-hidden="true" />
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-neon-magenta)] text-white"
              >
                <Sparkles className="h-2.5 w-2.5" />
              </span>
            </span>
            <div>
              <h2 className="font-display text-base font-bold tracking-tight">
                {t('dashboard.dailyBonusTitle')}
              </h2>
              <p className="text-xs text-muted-foreground">{t('dashboard.dailyBonusSubtitle')}</p>
            </div>
          </div>
        </div>

        {/* 7-day streak ladder. */}
        <motion.ol
          className="mt-4 grid grid-cols-7 gap-1.5"
          aria-label={t('dashboard.rewardLadderAria')}
          variants={ladder}
          initial="hidden"
          animate="show"
        >
          {LADDER.map((reward, i) => {
            const isPeak = i === LADDER.length - 1;
            return (
              <motion.li key={i} variants={rung} className="flex flex-col items-center gap-1">
                <span
                  className={cn(
                    'relative flex h-9 w-full flex-col items-center justify-center rounded-xl text-[0.625rem] font-bold tabular-nums ring-1',
                    isPeak
                      ? 'bg-[color-mix(in_oklch,var(--warning)_22%,transparent)] text-warning ring-[var(--warning)]/40'
                      : 'bg-background/50 text-foreground/80 ring-border/60',
                  )}
                >
                  {/* The peak reward gets a soft halo so the eye lands on the goal. */}
                  {isPeak && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute -inset-1 -z-10 rounded-2xl bg-[radial-gradient(circle,var(--warning)_0%,transparent_70%)] opacity-30 blur-md"
                    />
                  )}
                  <Coins className="h-3 w-3 opacity-70" aria-hidden="true" />
                  {reward}
                </span>
                <span className="text-[0.5625rem] text-muted-foreground">
                  {t('dashboard.dayShort', { day: i + 1 })}
                </span>
              </motion.li>
            );
          })}
        </motion.ol>

        {/* Actions. */}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => modals.open(MODAL.buyCoins, { fallback: COINS_ROUTE })}
            className={cn(
              'group inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-primary-foreground',
              'bg-gradient-to-r from-[var(--color-neon-violet)] via-[var(--color-neon-magenta)] to-[var(--color-neon-violet)] bg-[length:200%_100%] bg-left',
              'shadow-[0_8px_30px_-8px_var(--color-neon-violet)] transition-[background-position,transform] duration-500',
              'hover:bg-right active:scale-[0.98]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('dashboard.topUpBalance')}
          </button>
          <Link
            href={PREMIUM_ROUTE}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold',
              'border border-border/70 bg-background/50 text-foreground backdrop-blur',
              'transition-colors hover:bg-background/80',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <Sparkles className="h-4 w-4 text-[var(--color-neon-violet)]" aria-hidden="true" />
            {t('dashboard.premium')}
          </Link>
        </div>
      </div>
    </motion.section>
  );
}
