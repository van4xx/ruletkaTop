'use client';

/**
 * The dashboard identity block — a compact, premium "who am I" panel:
 *   - avatar (aurora ring for premium) + nickname + premium badge
 *   - live coin balance with a prominent "Пополнить" action (opens the
 *     buy-coins modal, falls back to /wallet)
 *   - quick "Редактировать" link to the profile editor
 *   - a premium-gated "Кто смотрел профиль" teaser driven by `profileViews`
 *     (locked CTA for non-premium users → /premium)
 *
 * Data: `useAuth` (session), `useProfile` (rich PublicProfile incl. views),
 * `useWallet` (balance). Each sub-area degrades independently (skeletons).
 */
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Coins, Crown, Eye, Lock, Pencil, Plus, Sparkles } from 'lucide-react';
import { Avatar, Skeleton, codeToFlag } from '@ruletka/ui';
import { useAuth } from '@/features/auth';
import { useProfile } from '@/features/profile/use-profile';
import { useWallet } from '@/hooks/wallet/use-wallet';
import { formatNumber } from '@/features/economy/format';
import { cn } from '@/lib/cn';
import { MODAL, useAppModals } from '@/hooks/dashboard/use-app-modals';
import { DashboardCard } from './dashboard-card';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Fallback route if the modal host isn't mounted (the buy-coins modal is primary). */
const COINS_ROUTE = '/wallet';
const PREMIUM_ROUTE = '/premium';

export function ProfileBlock() {
  const t = useTranslations('misc');
  const { user } = useAuth();
  const profileQuery = useProfile(user?.id);
  const walletQuery = useWallet();
  const modals = useAppModals();

  const profile = profileQuery.data;
  const isPremium = profile?.isPremium ?? user?.isPremium ?? false;
  const nickname = profile?.nickname ?? user?.nickname ?? '—';
  const balance = walletQuery.data?.balanceCoins ?? null;

  return (
    <DashboardCard label={t('dashboard.profileLabel')} padded={false}>
      {/* Aurora cover strip behind the avatar. */}
      <div aria-hidden="true" className="relative h-20 sm:h-24">
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-neon-violet)]/40 via-[var(--color-neon-magenta)]/25 to-[var(--color-neon-cyan)]/30" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_-30%,var(--color-neon-violet),transparent_60%)] opacity-50" />
        <div className="grain absolute inset-0" />
      </div>

      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        {/* Identity row — avatar overlaps the cover. */}
        <div className="-mt-10 flex items-end gap-3 sm:-mt-12">
          <div className="rounded-full ring-4 ring-card">
            {profileQuery.isLoading ? (
              <Skeleton className="h-[72px] w-[72px] rounded-full" />
            ) : (
              <Avatar
                src={profile?.avatarUrl ?? undefined}
                alt={nickname}
                size="xl"
                ring={isPremium ? 'aurora' : 'none'}
                className="size-[72px]"
              />
            )}
          </div>
          <div className="mb-1.5 min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h2 className="truncate font-display text-xl font-extrabold tracking-tight">
                {nickname}
              </h2>
              {isPremium && (
                <Crown
                  className="h-4 w-4 shrink-0 text-warning"
                  aria-label={t('dashboard.premiumAria')}
                />
              )}
            </div>
            {profile ? (
              <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span aria-hidden="true">{codeToFlag(profile.country)}</span>
                {isPremium ? t('dashboard.premiumAccount') : t('dashboard.basicAccount')}
              </p>
            ) : (
              <Skeleton className="mt-1 h-3 w-24" />
            )}
          </div>

          <Link
            href="/profile/me/edit"
            className={cn(
              'mb-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              'border border-border/70 bg-card/50 text-muted-foreground backdrop-blur',
              'transition-colors hover:bg-card/80 hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
            aria-label={t('dashboard.profileEditAria')}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>

        {/* Balance + top-up. */}
        <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-card/40 p-3 ring-1 ring-border/60">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--warning)_18%,transparent)] text-warning">
              <Coins className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                {t('dashboard.balance')}
              </p>
              {walletQuery.isLoading ? (
                <Skeleton className="mt-0.5 h-5 w-16" />
              ) : (
                <p className="font-display text-lg font-bold tabular-nums leading-none">
                  {balance != null ? formatNumber(balance) : '—'}
                  <span className="ml-1 text-xs font-medium text-muted-foreground">
                    {t('dashboard.coinsUnit')}
                  </span>
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => modals.open(MODAL.buyCoins, { fallback: COINS_ROUTE })}
            className={cn(
              'group inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-primary-foreground',
              'bg-gradient-to-r from-[var(--color-neon-violet)] via-[var(--color-neon-magenta)] to-[var(--color-neon-violet)] bg-[length:200%_100%] bg-left',
              'shadow-[0_8px_24px_-10px_var(--color-neon-violet)] transition-[background-position,transform] duration-500',
              'hover:bg-right active:scale-[0.97]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('dashboard.topUp')}
          </button>
        </div>

        {/* "Кто смотрел профиль" — premium teaser. */}
        <ProfileViewsTeaser
          isPremium={isPremium}
          views={profile?.profileViews ?? null}
          loading={profileQuery.isLoading}
        />
      </div>
    </DashboardCard>
  );
}

function ProfileViewsTeaser({
  isPremium,
  views,
  loading,
}: {
  isPremium: boolean;
  views: number | null;
  loading: boolean;
}) {
  const t = useTranslations('misc');
  if (loading) {
    return <Skeleton className="mt-3 h-14 w-full rounded-2xl" />;
  }

  if (isPremium) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE_OUT }}
        className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-card/40 p-3 ring-1 ring-border/60"
      >
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--color-neon-cyan)_16%,transparent)] text-[var(--color-neon-cyan)]">
            <Eye className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
              {t('dashboard.profileViewsTitle')}
            </p>
            <p className="font-display text-lg font-bold tabular-nums leading-none">
              {formatNumber(views ?? 0)}
              <span className="ml-1 text-xs font-medium text-muted-foreground">
                {t('dashboard.profileViewsUnit')}
              </span>
            </p>
          </div>
        </div>
        <Link
          href="/profile/me"
          className="text-xs font-medium text-[var(--color-neon-cyan)] transition-colors hover:text-foreground"
        >
          {t('dashboard.open')}
        </Link>
      </motion.div>
    );
  }

  // Non-premium: a tasteful locked teaser that upsells premium.
  return (
    <Link
      href={PREMIUM_ROUTE}
      className={cn(
        'group relative mt-3 flex items-center justify-between gap-3 overflow-hidden rounded-2xl p-3',
        'ring-1 ring-border/60 transition-colors hover:ring-[var(--color-neon-violet)]/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-r from-[var(--color-neon-violet)]/12 to-transparent opacity-80 transition-opacity group-hover:opacity-100"
      />
      <div className="relative flex items-center gap-2.5">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-card/70 text-muted-foreground ring-1 ring-border/60">
          <Lock className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{t('dashboard.profileViewsTitle')}</p>
          <p className="truncate text-xs text-muted-foreground">
            {t('dashboard.profileViewsLockedDesc')}
          </p>
        </div>
      </div>
      <span className="relative inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-neon-violet)]/15 px-2.5 py-1 text-[0.6875rem] font-semibold text-[var(--color-neon-violet)]">
        <Sparkles className="h-3 w-3" aria-hidden="true" />
        {t('dashboard.premium')}
      </span>
    </Link>
  );
}
