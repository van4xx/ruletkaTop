'use client';

import * as React from 'react';

import { cn } from '../lib/cn';

export interface MarqueeProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Scroll direction. `left` flows right→left; `right` flows left→right. */
  direction?: 'left' | 'right';
  /** Seconds for one full loop. Lower is faster. Defaults to 40. */
  speed?: number;
  /** Pause the animation while the pointer is over the track. Default true. */
  pauseOnHover?: boolean;
  /** Fade the left/right edges into the background. Default true. */
  fade?: boolean;
  /** The repeating content (e.g. a row of profile cards for the Top feed). */
  children: React.ReactNode;
}

/**
 * A horizontal, infinitely-scrolling marquee — the centerpiece of the Top feed.
 *
 * The content is duplicated once and the track is translated by exactly -50%
 * (or +50%), so the loop is perfectly seamless regardless of content width.
 * Both directions are supported, optional pause-on-hover, and edge fade. Honors
 * `prefers-reduced-motion` (the underlying animations are neutralized globally,
 * leaving a static, readable row).
 *
 * ```tsx
 * <Marquee direction="left" speed={50} className="py-3">
 *   {topUsers.map((u) => <TopCard key={u.id} user={u} />)}
 * </Marquee>
 * ```
 */
export const Marquee = React.forwardRef<HTMLDivElement, MarqueeProps>(function Marquee(
  {
    className,
    direction = 'left',
    speed = 40,
    pauseOnHover = true,
    fade = true,
    children,
    style,
    ...props
  },
  ref,
) {
  const animationName = direction === 'left' ? 'marquee-left' : 'marquee-right';

  return (
    <div
      ref={ref}
      className={cn('group relative w-full overflow-hidden', fade && 'mask-fade-x', className)}
      style={{ ...style, ['--marquee-duration' as string]: `${speed}s` }}
      {...props}
    >
      {/*
        Seamless loop: the track holds two identical segments separated by the
        same `gap` used *inside* each segment. The keyframes translate by
        `calc(-50% - gap/2)`, which is exactly one segment width plus one gap —
        so segment #2 lands precisely where segment #1 began, with no half-gap
        jump. `--marquee-gap` is the single source for both the flex gap and the
        keyframe offset, keeping them in lockstep.
      */}
      <div
        className={cn(
          'flex w-max shrink-0 items-stretch gap-[var(--marquee-gap)] [--marquee-gap:1rem]',
          pauseOnHover && 'group-hover:[animation-play-state:paused]',
        )}
        style={{ animation: `var(--animate-${animationName})` }}
      >
        <MarqueeSegment>{children}</MarqueeSegment>
        {/* Duplicate is aria-hidden so screen readers encounter the content once. */}
        <MarqueeSegment aria-hidden>{children}</MarqueeSegment>
      </div>
    </div>
  );
});

function MarqueeSegment({
  children,
  'aria-hidden': ariaHidden,
}: {
  children: React.ReactNode;
  'aria-hidden'?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-stretch gap-[var(--marquee-gap)]" aria-hidden={ariaHidden}>
      {children}
    </div>
  );
}
