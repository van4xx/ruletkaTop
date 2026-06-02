'use client';

/**
 * A single Top-feed card used inside the marquee. Resolves the placement's
 * public profile (nickname, avatar, country, premium) and links to
 * /profile/[id]. Falls back to a generated identicon while loading or if the
 * profile is unavailable. Higher-ranked (bigger spend) cards get a warmer glow.
 */
import Link from 'next/link';
import { Crown } from 'lucide-react';
import type { TopPlacement } from '@ruletka/shared-types';
import { Avatar, Skeleton, codeToFlag } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/features/economy/format';
import { useTopProfile } from '@/features/top/use-top';

export interface TopCardProps {
  placement: TopPlacement;
  rank: number;
}

/** Rank chip styling: gold/silver/bronze for the podium, muted otherwise. */
function rankChip(rank: number): string {
  if (rank === 1) return 'bg-[color-mix(in_oklch,var(--coin)_30%,transparent)] text-[var(--coin)]';
  if (rank === 2) return 'bg-foreground/15 text-foreground';
  if (rank === 3) return 'bg-[color-mix(in_oklch,var(--warning)_25%,transparent)] text-warning';
  return 'bg-card/60 text-muted-foreground';
}

export function TopCard({ placement, rank }: TopCardProps) {
  const { data: profile, isLoading } = useTopProfile(placement.userId);

  const nickname = profile?.nickname ?? 'Гость';
  const flag = profile?.country ? codeToFlag(profile.country) : '🌍';
  const podium = rank <= 3;

  return (
    <Link
      href={`/profile/${placement.userId}`}
      className={cn(
        'group relative flex w-64 shrink-0 items-center gap-3 overflow-hidden rounded-2xl p-3',
        'glass-panel transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5',
      )}
      aria-label={`${nickname} — место №${rank} в Топе`}
    >
      {/* Podium glow. */}
      {podium && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-6 -top-6 h-20 w-20 rounded-full bg-[radial-gradient(circle,var(--coin)_0%,transparent_70%)] opacity-25 blur-xl"
        />
      )}

      <span
        className={cn(
          'relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums',
          rankChip(rank),
        )}
      >
        {rank}
      </span>

      {isLoading ? (
        <Skeleton className="h-11 w-11 rounded-full" />
      ) : (
        <Avatar
          src={profile?.avatarUrl ?? undefined}
          alt={nickname}
          size="lg"
          ring={profile?.isPremium ? 'aurora' : 'none'}
          className="shrink-0"
        />
      )}

      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5">
          {isLoading ? (
            <Skeleton className="h-4 w-20" />
          ) : (
            <span className="truncate text-sm font-semibold text-foreground">{nickname}</span>
          )}
          {profile?.isPremium && (
            <Crown className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
          )}
        </span>
        <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <span aria-hidden="true">{flag}</span>
          <span className="tabular-nums">{formatNumber(placement.coinsSpent)} монет</span>
        </span>
      </span>
    </Link>
  );
}
