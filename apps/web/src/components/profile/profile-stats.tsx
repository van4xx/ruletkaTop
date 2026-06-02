'use client';

/**
 * The profile stats strip — a responsive row of glass stat tiles:
 *   • Подарки      — total coin value of received gifts
 *   • Просмотры     — profile views (premium-gated on OTHERS' profiles)
 *   • Друзья       — friends count (own profile only; no public-count API)
 *   • Топ          — current Top-feed placement status
 *
 * Each tile degrades independently: it shows a skeleton while loading, a locked
 * upsell state when premium-gated, or a neutral "—" when a metric is
 * unavailable for the given profile. Tiles never collapse the layout.
 */
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { motion, type Variants } from 'framer-motion';
import { Coins, Eye, Lock, Trophy, Users } from 'lucide-react';
import { CoinIcon, Skeleton } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/features/economy/format';
import { useModal } from '@/lib/stores/modal-store';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT } },
};

type Tone = 'coin' | 'cyan' | 'violet' | 'amber';

const TONE: Record<Tone, { tint: string; fg: string }> = {
  coin: { tint: 'bg-[color-mix(in_oklch,var(--warning)_16%,transparent)]', fg: 'text-warning' },
  cyan: {
    tint: 'bg-[color-mix(in_oklch,var(--color-neon-cyan)_16%,transparent)]',
    fg: 'text-[var(--color-neon-cyan)]',
  },
  violet: {
    tint: 'bg-[color-mix(in_oklch,var(--color-neon-violet)_16%,transparent)]',
    fg: 'text-[var(--color-neon-violet)]',
  },
  amber: { tint: 'bg-[color-mix(in_oklch,var(--warning)_16%,transparent)]', fg: 'text-warning' },
};

function StatTile({
  icon,
  tone,
  label,
  children,
}: {
  icon: ReactNode;
  tone: Tone;
  label: string;
  children: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <motion.div
      variants={item}
      className="group relative flex items-center gap-3 rounded-2xl bg-card/45 p-3.5 ring-1 ring-border/60 transition-colors hover:ring-border sm:flex-col sm:items-start sm:gap-2.5"
    >
      <span
        className={cn(
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
          t.tint,
          t.fg,
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="font-display text-lg font-bold leading-none tabular-nums">{children}</div>
        <p className="mt-1.5 truncate text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      </div>
    </motion.div>
  );
}

export interface ProfileStatsProps {
  /** Total coin value of received gifts. */
  giftsValueCoins: number;
  giftsLoading?: boolean;
  /** Raw profile-view count. */
  profileViews: number;
  /** Whether the viewer may see the view count (premium on others' profiles). */
  canSeeViews: boolean;
  /** Friends count — own profile only (no public count API). `null` hides the tile value. */
  friendsCount?: number | null;
  friendsLoading?: boolean;
  /** Top-feed placement status. */
  isTopPlaced: boolean;
  topLoading?: boolean;
  /** When true, the views tile links to /premium instead of showing the count. */
  isOwnProfile?: boolean;
}

export function ProfileStats({
  giftsValueCoins,
  giftsLoading,
  profileViews,
  canSeeViews,
  friendsCount,
  friendsLoading,
  isTopPlaced,
  topLoading,
  isOwnProfile,
}: ProfileStatsProps) {
  const t = useTranslations('profile');
  const { open } = useModal();
  const showFriends = friendsCount !== undefined && friendsCount !== null;

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className={cn('grid grid-cols-2 gap-3', showFriends ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}
      aria-label={t('stats.ariaLabel')}
    >
      {/* Gifts value */}
      <StatTile
        icon={<Coins className="h-4.5 w-4.5" aria-hidden="true" />}
        tone="coin"
        label={t('stats.giftsLabel')}
      >
        {giftsLoading ? (
          <Skeleton className="h-5 w-16" />
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <CoinIcon size="sm" className="text-[var(--coin)]" />
            {formatNumber(giftsValueCoins)}
          </span>
        )}
      </StatTile>

      {/* Profile views */}
      {canSeeViews ? (
        <StatTile
          icon={<Eye className="h-4.5 w-4.5" aria-hidden="true" />}
          tone="cyan"
          label={t('stats.viewsLabel')}
        >
          {formatNumber(profileViews)}
        </StatTile>
      ) : (
        <button
          type="button"
          onClick={() => open('premium', { reason: t('stats.viewsLockedReason') })}
          aria-label={t('stats.viewsLockedAria')}
          className="group relative flex items-center gap-3 overflow-hidden rounded-2xl p-3.5 text-left ring-1 ring-border/60 transition-colors hover:ring-[var(--color-neon-violet)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:flex-col sm:items-start sm:gap-2.5"
        >
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-br from-[var(--color-neon-violet)]/10 to-transparent opacity-80 transition-opacity group-hover:opacity-100"
          />
          <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-card/70 text-muted-foreground ring-1 ring-border/60">
            <Lock className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="relative min-w-0">
            <div className="font-display text-sm font-bold leading-tight">{t('stats.hidden')}</div>
            <p className="mt-1 truncate text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
              {t('stats.viewsLockedCaption')}
            </p>
          </div>
        </button>
      )}

      {/* Friends (own profile) */}
      {showFriends && (
        <StatTile
          icon={<Users className="h-4.5 w-4.5" aria-hidden="true" />}
          tone="violet"
          label={t('stats.friendsLabel')}
        >
          {friendsLoading ? <Skeleton className="h-5 w-10" /> : formatNumber(friendsCount ?? 0)}
        </StatTile>
      )}

      {/* Top placement */}
      <StatTile
        icon={<Trophy className="h-4.5 w-4.5" aria-hidden="true" />}
        tone="amber"
        label={t('stats.topLabel')}
      >
        {topLoading ? (
          <Skeleton className="h-5 w-14" />
        ) : isTopPlaced ? (
          <span className="text-gradient-neon">
            {isOwnProfile ? t('stats.topPlacedOwn') : t('stats.topPlacedOther')}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </StatTile>
    </motion.div>
  );
}
