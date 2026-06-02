'use client';

/**
 * The signature Top feed: two infinite marquee rows moving in OPPOSITE
 * directions (top → right, bottom → left), pausing on hover. Each card links to
 * a profile. Handles loading (shimmer rows), empty, and error states.
 *
 * The two API lanes (`left`, `right`) drive the two rows; cards are ordered by
 * priority (spend) descending, so rank = index + 1 within a lane.
 */
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import type { TopPlacement } from '@ruletka/shared-types';
import { Marquee, Skeleton } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { TopCard } from './top-card';

function SkeletonRow({ reverse }: { reverse?: boolean }) {
  return (
    <div className={cn('flex gap-4 py-1', reverse && 'flex-row-reverse')} aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="glass-panel flex w-64 shrink-0 items-center gap-3 rounded-2xl p-3">
          <Skeleton className="h-7 w-7 rounded-full" />
          <Skeleton className="h-11 w-11 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({
  placements,
  direction,
}: {
  placements: TopPlacement[];
  direction: 'left' | 'right';
}) {
  return (
    <Marquee direction={direction} speed={48} pauseOnHover className="py-1">
      {placements.map((p, i) => (
        <TopCard key={p.id} placement={p} rank={i + 1} />
      ))}
    </Marquee>
  );
}

export interface TopFeedMarqueeProps {
  left: TopPlacement[];
  right: TopPlacement[];
  isLoading: boolean;
}

export function TopFeedMarquee({ left, right, isLoading }: TopFeedMarqueeProps) {
  const t = useTranslations('economy');
  if (isLoading) {
    return (
      <div className="space-y-4">
        <SkeletonRow />
        <SkeletonRow reverse />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top row → scrolls RIGHT (content flows left→right). */}
      {left.length > 0 ? (
        <Row placements={left} direction="right" />
      ) : (
        <LaneHint label={t('topFeed.topLaneFree')} />
      )}

      {/* Bottom row → scrolls LEFT. */}
      {right.length > 0 ? (
        <Row placements={right} direction="left" />
      ) : (
        <LaneHint label={t('topFeed.bottomLaneFree')} />
      )}
    </div>
  );
}

function LaneHint({ label }: { label: string }) {
  return (
    <div className="glass-panel flex items-center justify-center gap-2 rounded-2xl px-4 py-6 text-sm text-muted-foreground">
      {label}
      <ArrowRight className="h-4 w-4 text-[var(--color-neon-cyan)]" aria-hidden="true" />
    </div>
  );
}
