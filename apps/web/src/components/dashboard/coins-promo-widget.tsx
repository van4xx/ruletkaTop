'use client';

/**
 * Daily-bonus widget — the LIVE dashboard surface for `GET /economy/daily-bonus`
 * and `POST /economy/daily-bonus/claim`.
 *
 * The 7-rung row mirrors the canonical {@link DAILY_BONUS_LADDER} (the same
 * 2/3/3/4/5/6/7-coin ladder the wallet credits against), so the rendered amount
 * under each rung is the SOURCE OF TRUTH from `@ruletka/shared-types` — never a
 * hard-coded duplicate that could drift from the backend.
 *
 * The widget keeps the existing visual identity (glass + neon-violet/magenta
 * gradient, golden Day-7 halo), so the dashboard composition reads the same;
 * the change is that the rungs now reflect REAL state (filled past, halo on
 * today, muted future), the primary button claims and credits coins through
 * the wallet, and the disabled-until-midnight chip shows the actual reset
 * countdown computed against `nextResetAt` from the server (no client clock).
 *
 * Filename stayed at `coins-promo-widget.tsx` deliberately so the dashboard
 * composition (`dashboard-client.tsx`) doesn't have to re-import the widget.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Coins, Gift, Plus, Sparkles } from 'lucide-react';
import { toast } from '@ruletka/ui';
import { DAILY_BONUS_LADDER } from '@ruletka/shared-types';

import { cn } from '@/lib/cn';
import { MODAL, useAppModals } from '@/hooks/dashboard/use-app-modals';
import { useDailyBonus, useClaimDailyBonus, dailyBonusKeys } from '@/features/daily-bonus/use-daily-bonus';
import { usePremiumTier } from '@/features/premium/use-premium-tier';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
/** Fallback route if the modal host isn't mounted (the buy-coins modal is primary). */
const COINS_ROUTE = '/wallet';

/** Quick left-to-right "climb" as the rungs settle in. */
const ladderVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.15 } },
};

const rungVariants: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.9 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: EASE_OUT } },
};

/**
 * Hook: a "ticking" timestamp that updates once a minute. Used to compute the
 * hours-until-reset label without an inner-loop rerender on every animation
 * frame. The ticker is stopped on unmount; we don't even register it under
 * reduced motion (the countdown label can stay until the next mount; that's a
 * trade-off the spec accepts to honour the motion preference precisely).
 */
function useMinuteTick(enabled: boolean): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const id = window.setInterval(() => setTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return tick;
}

/** Ceil the gap to `nextResetAt` to whole hours (so "0h" never shows mid-day). */
function hoursUntil(nextResetAtIso: string | undefined, nowMs: number): number {
  if (!nextResetAtIso) return 0;
  const resetMs = Date.parse(nextResetAtIso);
  if (!Number.isFinite(resetMs)) return 0;
  const diffMs = Math.max(0, resetMs - nowMs);
  // Always show at least 1h until the actual reset, so a "0h" right before
  // midnight isn't misread as "claimable now" while the button is disabled.
  return Math.max(1, Math.ceil(diffMs / 3_600_000));
}

export function CoinsPromoWidget() {
  const t = useTranslations('misc');
  const tEconomy = useTranslations('economy');
  const modals = useAppModals();
  const qc = useQueryClient();
  const prefersReducedMotion = useReducedMotion() ?? false;

  const stateQuery = useDailyBonus();
  const claim = useClaimDailyBonus();
  // Tier multiplier badge in the subtitle — server already returns the
  // post-multiplier `nextRewardCoins`, so the badge here is purely a label
  // (no client-side math). `'none'` reads as a plain widget (no badge).
  const tier = usePremiumTier().tier;

  // Tick once a minute so the "вернись через Nч" countdown stays fresh after
  // the user has claimed today. Pause the ticker when there's no countdown
  // to show (no data yet, or the user can still claim).
  const tickerActive = Boolean(stateQuery.data?.claimedToday);
  const nowMs = useMinuteTick(tickerActive);

  // Track the most-recently-claimed rung so the "+N" float-up animation
  // anchors to the right cell. Cleared after the float-up's lifetime.
  const [floatUpKey, setFloatUpKey] = useState<number | null>(null);

  const state = stateQuery.data;
  const ladder = state?.ladder ?? DAILY_BONUS_LADDER;
  const streak = state?.streak ?? 0;
  const canClaim = state?.canClaim ?? false;
  const claimedToday = state?.claimedToday ?? false;
  const nextRewardCoins = state?.nextRewardCoins ?? ladder[0]!;

  // The visually "active" rung. When the user can still claim today it's the
  // rung the NEXT claim will land on (streak+1, wrapped). When they've already
  // claimed it's the rung that was just credited (streak).
  const activeIndex = useMemo(() => {
    if (!state) return -1;
    if (claimedToday) {
      return Math.max(0, state.streak - 1);
    }
    // Next claim continues the cycle if yesterday's streak is live; otherwise
    // the next claim resets to streak=1. We mirror the backend math: if streak
    // is 0 (never claimed) or a skipped day broke the chain, server sets
    // nextRewardCoins to ladder[0] — which is precisely index 0 here.
    if (streak === 0) return 0;
    return streak % 7; // streak 7 → next is index 0; streak 1 → index 1; etc.
  }, [state, claimedToday, streak]);

  const hoursToReset = hoursUntil(state?.nextResetAt, nowMs);

  const handleClaim = (): void => {
    if (!state?.canClaim || claim.isPending) return;
    claim.mutate(undefined, {
      onSuccess: (res) => {
        // Anchor the "+N" float-up to the just-credited rung.
        setFloatUpKey(res.streak - 1);
        // Clear the anchor after 600ms — matches the float-up duration so a
        // subsequent claim (next day) starts from a clean state.
        window.setTimeout(() => setFloatUpKey(null), 600);
        toast.success(
          t('dashboard.dailyBonusClaimSuccess', {
            coins: res.justCredited,
            streak: res.streak,
          }),
        );
      },
      onError: () => {
        toast.error(t('dashboard.dailyBonusClaimError'));
      },
    });
  };

  const handleRetry = (): void => {
    void qc.invalidateQueries({ queryKey: dailyBonusKeys.state() });
  };

  // ── Loading skeleton — don't blank the card.
  if (stateQuery.isLoading) {
    return (
      <section
        aria-label={t('dashboard.coinsPromoLabel')}
        className="relative overflow-hidden rounded-3xl"
      >
        <div className="glass-panel absolute inset-0 -z-10 rounded-3xl border-0" aria-hidden="true" />
        <div className="p-5 sm:p-6">
          <div className="flex items-center gap-2.5">
            <div className="h-11 w-11 rounded-2xl bg-foreground/5" />
            <div className="space-y-2">
              <div className="h-3.5 w-32 rounded bg-foreground/10" />
              <div className="h-2.5 w-48 rounded bg-foreground/5" />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-7 gap-1.5">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-9 rounded-xl bg-foreground/5" />
            ))}
          </div>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <div className="h-10 flex-1 rounded-xl bg-foreground/10" />
            <div className="h-10 flex-1 rounded-xl bg-foreground/5" />
          </div>
        </div>
      </section>
    );
  }

  return (
    <motion.section
      aria-label={t('dashboard.coinsPromoLabel')}
      initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
      animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
      transition={prefersReducedMotion ? undefined : { duration: 0.55, ease: EASE_OUT }}
      className="relative overflow-hidden rounded-3xl"
    >
      {/* Rich layered gradient + glow (unchanged from the teaser — kept as the
          card's visual identity on the dashboard). */}
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
              <p className="text-xs text-muted-foreground">
                {t('dashboard.dailyBonusSubtitle')}
                {/* Tier multiplier label — pure cosmetic; the server already
                    returned the post-multiplier amount. Title attribute powers
                    the native tooltip (e.g. "Premium Pro x2!"). */}
                {tier === 'pro' && (
                  <span
                    title={tEconomy('dailyBonusTier.tooltipPro')}
                    className="ml-1.5 inline-flex items-center rounded-full bg-warning/15 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-warning"
                  >
                    Pro x2
                  </span>
                )}
                {tier === 'lite' && (
                  <span
                    title={tEconomy('dailyBonusTier.tooltipLite')}
                    className="ml-1.5 inline-flex items-center rounded-full bg-accent/15 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-accent"
                  >
                    Lite x1.5
                  </span>
                )}
              </p>
            </div>
          </div>
          {streak > 0 && (
            <span
              className={cn(
                'inline-flex items-center gap-1 self-center rounded-full px-2.5 py-1 text-[0.625rem] font-semibold uppercase tracking-wide',
                'bg-background/60 text-foreground/80 ring-1 ring-border/60',
              )}
              aria-label={t('dashboard.dailyBonusStreakLabel', { days: streak })}
            >
              <Sparkles className="h-3 w-3 text-[var(--color-neon-violet)]" aria-hidden="true" />
              {t('dashboard.dailyBonusStreakLabel', { days: streak })}
            </span>
          )}
        </div>

        {/* ── Error chip + retry ─────────────────────────────────────────── */}
        {stateQuery.isError && (
          <div
            role="alert"
            className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            <span>{t('dashboard.dailyBonusLoadError')}</span>
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-md bg-background/70 px-2.5 py-1 text-xs font-semibold text-foreground ring-1 ring-border/60 transition-colors hover:bg-background/90"
            >
              {t('dashboard.dailyBonusRetry')}
            </button>
          </div>
        )}

        {/* ── 7-rung ladder ──────────────────────────────────────────────── */}
        <motion.ol
          className="mt-4 grid grid-cols-7 gap-1.5"
          aria-label={t('dashboard.rewardLadderAria')}
          variants={prefersReducedMotion ? undefined : ladderVariants}
          initial={prefersReducedMotion ? false : 'hidden'}
          animate={prefersReducedMotion ? undefined : 'show'}
        >
          {ladder.map((reward, i) => {
            const isPeak = i === ladder.length - 1;
            const isCompleted = i < streak && !(claimedToday && i === streak - 1);
            const isActive = i === activeIndex;
            const isJustClaimed = floatUpKey === i;
            const isFuture = !isCompleted && !isActive;
            return (
              <motion.li
                key={i}
                variants={prefersReducedMotion ? undefined : rungVariants}
                className={cn(
                  'relative flex flex-col items-center gap-1',
                  isActive && 'z-10',
                )}
                aria-current={isActive ? 'step' : undefined}
              >
                <span
                  className={cn(
                    'relative flex w-full flex-col items-center justify-center rounded-xl text-[0.625rem] font-bold tabular-nums ring-1 transition-all',
                    isActive ? 'h-10 sm:h-11' : 'h-9',
                    isCompleted &&
                      'bg-[color-mix(in_oklch,var(--color-neon-violet)_22%,transparent)] text-foreground ring-[var(--color-neon-violet)]/50 shadow-[0_0_12px_-4px_var(--color-neon-cyan)]',
                    isActive &&
                      !isPeak &&
                      'bg-[color-mix(in_oklch,var(--color-neon-magenta)_24%,transparent)] text-foreground ring-[var(--color-neon-magenta)]/60',
                    isPeak &&
                      'bg-[color-mix(in_oklch,var(--warning)_22%,transparent)] text-warning ring-[var(--warning)]/40',
                    isFuture && 'bg-background/50 text-foreground/60 ring-border/60',
                  )}
                >
                  {/* Bouncing halo on the active (today) rung — collapsed for
                      reduced-motion preference. */}
                  {isActive && !prefersReducedMotion && (
                    <motion.span
                      aria-hidden="true"
                      className="pointer-events-none absolute -inset-1 -z-10 rounded-2xl bg-[radial-gradient(circle,var(--color-neon-magenta)_0%,transparent_70%)] opacity-40 blur-md"
                      animate={{ scale: [1, 1.15, 1], opacity: [0.35, 0.55, 0.35] }}
                      transition={{ duration: 1.8, ease: EASE_OUT, repeat: Infinity }}
                    />
                  )}
                  {/* Day-7 keeps its golden halo regardless of completion. */}
                  {isPeak && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute -inset-1 -z-10 rounded-2xl bg-[radial-gradient(circle,var(--warning)_0%,transparent_70%)] opacity-30 blur-md"
                    />
                  )}
                  {isCompleted ? (
                    <Check className="h-3 w-3 opacity-80" aria-hidden="true" />
                  ) : (
                    <Coins className="h-3 w-3 opacity-70" aria-hidden="true" />
                  )}
                  {reward}
                </span>
                <span className="text-[0.5625rem] text-muted-foreground">
                  {isActive
                    ? t('dashboard.dailyBonusTodayAria')
                    : t('dashboard.dayShort', { day: i + 1 })}
                </span>

                {/* "+N" float-up over the just-claimed rung (~600ms). */}
                {isJustClaimed && !prefersReducedMotion && (
                  <motion.span
                    aria-hidden="true"
                    initial={{ opacity: 0, y: 0, scale: 0.8 }}
                    animate={{ opacity: [0, 1, 0], y: -28, scale: 1 }}
                    transition={{ duration: 0.6, ease: EASE_OUT }}
                    className="pointer-events-none absolute -top-1 text-xs font-bold text-warning drop-shadow-[0_0_6px_var(--warning)]"
                  >
                    +{reward}
                  </motion.span>
                )}
              </motion.li>
            );
          })}
        </motion.ol>

        {/* ── Actions ────────────────────────────────────────────────────── */}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          {canClaim ? (
            <button
              type="button"
              onClick={handleClaim}
              disabled={claim.isPending}
              aria-disabled={claim.isPending}
              className={cn(
                'group inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-primary-foreground',
                'bg-gradient-to-r from-[var(--color-neon-violet)] via-[var(--color-neon-magenta)] to-[var(--color-neon-violet)] bg-[length:200%_100%] bg-left',
                'shadow-[0_8px_30px_-8px_var(--color-neon-violet)] transition-[background-position,transform] duration-500',
                'hover:bg-right active:scale-[0.98]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                claim.isPending && 'cursor-progress opacity-80',
              )}
            >
              <Coins className="h-4 w-4" aria-hidden="true" />
              {t('dashboard.dailyBonusClaim', { coins: nextRewardCoins })}
            </button>
          ) : (
            <div
              role="status"
              aria-live="polite"
              className={cn(
                'inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium',
                'bg-background/40 text-muted-foreground ring-1 ring-border/60 backdrop-blur',
              )}
            >
              <Check className="h-4 w-4 text-[var(--color-neon-cyan)]" aria-hidden="true" />
              {t('dashboard.dailyBonusAlreadyClaimed', { hours: hoursToReset })}
            </div>
          )}
          <Link
            href={COINS_ROUTE}
            onClick={(e) => {
              e.preventDefault();
              modals.open(MODAL.buyCoins, { fallback: COINS_ROUTE });
            }}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold',
              'border border-border/70 bg-background/50 text-foreground backdrop-blur',
              'transition-colors hover:bg-background/80',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <Plus className="h-4 w-4 text-[var(--color-neon-violet)]" aria-hidden="true" />
            {t('dashboard.topUpBalance')}
          </Link>
        </div>
      </div>
    </motion.section>
  );
}
