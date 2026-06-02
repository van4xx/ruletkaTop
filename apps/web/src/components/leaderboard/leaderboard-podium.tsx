'use client';

/**
 * Top-3 podium for the leaderboard. Renders the classic center-tallest layout
 * (2 · 1 · 3) on wider screens and a clean stacked order on mobile. Each plinth
 * carries the user's avatar (gold/silver/bronze ring), name, rank medal and
 * metric score, with a staggered rise-in animation.
 */
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Crown } from 'lucide-react';
import { Avatar } from '@ruletka/ui';
import type { LeaderboardEntry, LeaderboardMetric } from '@ruletka/shared-types';
import { cn } from '@/lib/cn';
import { ScoreDisplay } from './leaderboard-list';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Visual config per rank (1-based). */
const RANK_STYLES: Record<
  1 | 2 | 3,
  { ring: string; glow: string; medal: string; plinth: string; order: string; height: string }
> = {
  1: {
    ring: 'ring-[color-mix(in_oklch,var(--coin)_70%,white)]',
    glow: 'from-[color-mix(in_oklch,var(--coin)_35%,transparent)]',
    medal: 'bg-[var(--coin)] text-[var(--coin-foreground)]',
    plinth: 'border-[var(--coin)]/40',
    order: 'order-1 sm:order-2',
    height: 'sm:h-44',
  },
  2: {
    ring: 'ring-slate-300',
    glow: 'from-slate-300/25',
    medal: 'bg-slate-200 text-slate-800',
    plinth: 'border-slate-300/40',
    order: 'order-2 sm:order-1',
    height: 'sm:h-36',
  },
  3: {
    ring: 'ring-amber-700',
    glow: 'from-amber-700/25',
    medal: 'bg-amber-700 text-amber-50',
    plinth: 'border-amber-700/40',
    order: 'order-3 sm:order-3',
    height: 'sm:h-32',
  },
};

function PodiumColumn({
  entry,
  rank,
  metric,
}: {
  entry: LeaderboardEntry;
  rank: 1 | 2 | 3;
  metric: LeaderboardMetric;
}) {
  const s = RANK_STYLES[rank];
  const name = entry.nickname || 'Участник';
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE_OUT, delay: (3 - rank) * 0.08 }}
      className="flex w-full flex-col items-center"
    >
      {/* Avatar + medal */}
      <div className="relative">
        {rank === 1 && (
          <Crown
            className="absolute -top-6 left-1/2 h-6 w-6 -translate-x-1/2 text-[var(--coin)] drop-shadow-[0_0_10px_var(--coin)]"
            aria-hidden="true"
          />
        )}
        <Avatar
          src={entry.avatarUrl}
          alt={name}
          size={rank === 1 ? 'xl' : 'lg'}
          className={cn('ring-2 ring-offset-2 ring-offset-background', s.ring)}
        />
        <span
          className={cn(
            'absolute -bottom-1.5 left-1/2 inline-flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full text-sm font-bold shadow-md ring-2 ring-background',
            s.medal,
          )}
          aria-hidden="true"
        >
          {rank}
        </span>
      </div>

      {/* Name */}
      <p className="mt-4 max-w-[9rem] truncate text-center font-display text-sm font-bold tracking-tight">
        {name}
      </p>
      <div className="mt-1.5">
        <ScoreDisplay metric={metric} score={entry.score} size="sm" />
      </div>

      {/* Plinth */}
      <div
        className={cn(
          'relative mt-4 flex w-full items-start justify-center overflow-hidden rounded-t-xl border-x border-t bg-card/40 pt-3',
          'h-20',
          s.height,
          s.plinth,
        )}
      >
        <div
          aria-hidden="true"
          className={cn('absolute inset-0 bg-gradient-to-t to-transparent opacity-60', s.glow)}
        />
        <span className="relative font-display text-3xl font-extrabold text-foreground/15 sm:text-4xl">
          {rank}
        </span>
      </div>
    </motion.div>
  );
}

export function LeaderboardPodium({
  top,
  metric,
}: {
  top: LeaderboardEntry[];
  metric: LeaderboardMetric;
}) {
  // Expect up to 3 entries; render only what exists.
  const ranks: (1 | 2 | 3)[] = [2, 1, 3];

  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 -top-8 mx-auto h-40 max-w-md rounded-full bg-[radial-gradient(ellipse_at_center,color-mix(in_oklch,var(--coin)_18%,transparent),transparent_70%)] blur-2xl"
      />
      <div className="relative flex flex-col items-end justify-center gap-4 px-2 sm:flex-row sm:gap-3">
        {ranks.map((rank) => {
          const entry = top[rank - 1];
          if (!entry) return null;
          const name = entry.nickname || 'Участник';
          return (
            <div key={rank} className={cn('flex w-full flex-1', RANK_STYLES[rank].order)}>
              <Link
                href={`/profile/${entry.userId}`}
                aria-label={`${name}, ${rank}-е место`}
                className="flex w-full rounded-xl outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <PodiumColumn entry={entry} rank={rank} metric={metric} />
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
