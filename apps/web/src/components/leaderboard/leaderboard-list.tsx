'use client';

/**
 * Ranked list rows for the leaderboard (positions below the podium). Each row:
 * rank number, avatar + name + meta, and the metric score — links to the
 * profile. The caller's own row is highlighted. Includes a matching skeleton.
 */
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Calendar, Crown, Gift, Sparkles } from 'lucide-react';
import { Avatar, Badge, CoinBalance, Skeleton } from '@ruletka/ui';
import type { LeaderboardEntry, LeaderboardMetric } from '@ruletka/shared-types';
import { cn } from '@/lib/cn';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

function RankBadge({ rank, highlight }: { rank: number; highlight?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-display text-sm font-bold tabular-nums ring-1',
        highlight
          ? 'bg-primary/20 text-primary ring-primary/40'
          : 'bg-card/60 text-muted-foreground ring-border/60',
      )}
      aria-hidden="true"
    >
      {rank}
    </span>
  );
}

/** The small score chip + caption, by metric. */
export function ScoreDisplay({
  metric,
  score,
  size = 'md',
}: {
  metric: LeaderboardMetric;
  score: number;
  size?: 'sm' | 'md';
}) {
  const t = useTranslations('misc');
  if (metric === 'top') {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-card/70 px-3 font-medium tabular-nums ring-1 ring-border/60',
          size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm',
        )}
      >
        <Calendar className="h-3.5 w-3.5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
        {t('leaderboard.days', { count: score })}
      </span>
    );
  }
  // gifts + coins are both coin-denominated values.
  return <CoinBalance amount={score} size={size} variant="pill" className="shrink-0" compact />;
}

/** Per-metric one-line caption under the name. */
function MetricCaption({ metric, score: _score }: { metric: LeaderboardMetric; score: number }) {
  const t = useTranslations('misc');
  if (metric === 'gifts') {
    return (
      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
        <Gift className="h-3 w-3 text-[var(--color-neon-magenta)]" aria-hidden="true" />
        {t('leaderboard.giftsReceived')}
      </p>
    );
  }
  if (metric === 'top') {
    return (
      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
        <Crown className="h-3 w-3 text-[var(--coin)]" aria-hidden="true" />
        {t('leaderboard.daysInTop')}
      </p>
    );
  }
  return (
    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
      <Sparkles className="h-3 w-3 text-[var(--coin)]" aria-hidden="true" />
      {t('leaderboard.coinBalance')}
    </p>
  );
}

export function LeaderboardRow({
  entry,
  metric,
  isMe,
}: {
  entry: LeaderboardEntry;
  metric: LeaderboardMetric;
  isMe?: boolean;
}) {
  const t = useTranslations('misc');
  const name = entry.nickname || t('leaderboard.memberFallback');

  return (
    <motion.li
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4, ease: EASE_OUT }}
    >
      <Link
        href={`/profile/${entry.userId}`}
        aria-current={isMe ? 'true' : undefined}
        className={cn(
          'flex items-center gap-3 rounded-2xl px-4 py-3 transition-colors sm:gap-4',
          isMe
            ? 'glass-panel bg-primary/10 ring-1 ring-primary/40 hover:bg-primary/15'
            : 'glass-panel hover:bg-card/70',
        )}
      >
        <RankBadge rank={entry.rank} highlight={isMe} />
        <Avatar
          src={entry.avatarUrl}
          alt={name}
          size="md"
          ring={entry.isPremium ? 'aurora' : 'none'}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium text-foreground">{name}</p>
            {isMe && (
              <Badge variant="outline" size="sm" className="shrink-0">
                {t('leaderboard.you')}
              </Badge>
            )}
            {entry.isPremium && (
              <Badge variant="aurora" size="sm" className="shrink-0">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                Premium
              </Badge>
            )}
          </div>
          <MetricCaption metric={metric} score={entry.score} />
        </div>
        <ScoreDisplay metric={metric} score={entry.score} />
      </Link>
    </motion.li>
  );
}

export function LeaderboardListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul className="space-y-2.5" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="glass-panel flex items-center gap-3 rounded-2xl px-4 py-3 sm:gap-4">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-7 w-20 rounded-full" />
        </li>
      ))}
    </ul>
  );
}
