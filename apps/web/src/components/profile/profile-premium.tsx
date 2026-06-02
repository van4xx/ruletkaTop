'use client';

/**
 * Own-profile premium surfaces:
 *
 *   • {@link ProfileViewsPanel} — "кто смотрел профиль". For premium members it
 *     shows the view count with a tasteful note that the visitor list is rolling
 *     out; for everyone else it's a locked upsell that opens the premium modal.
 *     (The contract exposes `profileViews` but not a per-viewer list yet, so we
 *     present the count honestly rather than fabricating identities.)
 *
 *   • {@link PremiumUpsellCard} — a gradient-bordered card pitching premium with
 *     its headline perks; hidden for users who are already premium.
 */
import { useTranslations } from 'next-intl';
import { motion, useReducedMotion } from 'framer-motion';
import { Crown, Eye, Lock, Sparkles, TrendingUp } from 'lucide-react';
import { Button } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/features/economy/format';
import { useModal } from '@/lib/stores/modal-store';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/* ── Кто смотрел профиль ──────────────────────────────────────────────── */

export function ProfileViewsPanel({ isPremium, views }: { isPremium: boolean; views: number }) {
  const t = useTranslations('profile');
  const { open } = useModal();

  if (isPremium) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE_OUT }}
        className="glass-panel rounded-3xl p-5 sm:p-6"
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--color-neon-cyan)_16%,transparent)] text-[var(--color-neon-cyan)]">
            <Eye className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-display text-base font-bold tracking-tight">
              {t('premium.viewsTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('premium.viewsPremiumActive')}</p>
          </div>
        </div>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="font-display text-3xl font-extrabold tabular-nums text-gradient-neon">
            {formatNumber(views)}
          </span>
          <span className="text-sm text-muted-foreground">{t('premium.viewsCountSuffix')}</span>
        </div>
        <p className="mt-3 rounded-xl bg-card/40 px-3.5 py-2.5 text-xs text-muted-foreground ring-1 ring-border/50">
          {t('premium.viewsRollingNote')}
        </p>
      </motion.div>
    );
  }

  // Locked upsell.
  return (
    <button
      type="button"
      onClick={() => open('premium', { reason: t('premium.viewsLockedReason') })}
      className={cn(
        'group relative w-full overflow-hidden rounded-3xl p-5 text-left ring-1 ring-border/60 transition-colors sm:p-6',
        'hover:ring-[var(--color-neon-violet)]/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-br from-[var(--color-neon-violet)]/14 via-transparent to-[var(--color-neon-cyan)]/10 opacity-90 transition-opacity group-hover:opacity-100"
      />
      <div className="relative flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-card/70 text-muted-foreground ring-1 ring-border/60">
            <Lock className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold tracking-tight">
              {t('premium.viewsTitle')}
            </h2>
            <p className="truncate text-sm text-muted-foreground">
              {t('premium.viewsLockedCaption', { count: formatNumber(views) })}
            </p>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-neon-violet)]/15 px-2.5 py-1 text-[0.6875rem] font-semibold text-[var(--color-neon-violet)]">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          {t('premium.badge')}
        </span>
      </div>
    </button>
  );
}

/* ── Premium upsell card ──────────────────────────────────────────────── */

const PERKS: Array<{ icon: typeof Eye; key: 'perkViews' | 'perkPriority' | 'perkGifts' }> = [
  { icon: Eye, key: 'perkViews' },
  { icon: TrendingUp, key: 'perkPriority' },
  { icon: Crown, key: 'perkGifts' },
];

export function PremiumUpsellCard() {
  const t = useTranslations('profile');
  const { open } = useModal();
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
      className="relative overflow-hidden rounded-3xl border-aurora p-[1px]"
    >
      <div className="glass-panel relative overflow-hidden rounded-[calc(1.5rem-1px)] p-5 sm:p-6">
        {/* Atmospheric glow. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-[radial-gradient(circle,var(--color-neon-violet),transparent_65%)] opacity-40 blur-2xl"
        />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-aurora text-accent-foreground shadow-glow">
              <Crown className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-display text-lg font-bold tracking-tight">
                {t('premium.upsellTitlePrefix')}{' '}
                <span className="text-gradient-neon">{t('premium.upsellTitleHighlight')}</span>
              </h2>
              <p className="text-sm text-muted-foreground">{t('premium.upsellSubtitle')}</p>
            </div>
          </div>

          <ul className="mt-4 grid gap-2">
            {PERKS.map(({ icon: Icon, key }) => (
              <li key={key} className="flex items-center gap-2.5 text-sm text-foreground/90">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-card/60 text-[var(--color-neon-violet)] ring-1 ring-border/50">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                {t(`premium.${key}`)}
              </li>
            ))}
          </ul>

          <Button
            variant="primary"
            block
            className={cn('mt-5', !reduce && 'group')}
            leadingIcon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
            onClick={() => open('premium', {})}
          >
            {t('premium.upsellButton')}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
