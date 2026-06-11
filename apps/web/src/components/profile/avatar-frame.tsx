'use client';

/**
 * Decorative ring drawn AROUND a child `<Avatar>` for the avatar-frame
 * cosmetic. The avatar URL is unchanged — the frame is a pure presentation
 * layer that adds a ring outset 16px on every side (so the rendered area is
 * 32px taller and wider than the bare avatar) and renders ABOVE the avatar
 * disk but BELOW any interactive overlay (presence dot, edit button).
 *
 * Usage (see {@link ProfileHeader}):
 * ```tsx
 * <AvatarFrame frameId={profile.equippedFrameId}>
 *   <Avatar src={profile.avatarUrl} ... />
 * </AvatarFrame>
 * ```
 *
 * If `frameId` is `null`/unknown the wrapper is transparent — the child
 * renders exactly as-is (zero visual delta), so introducing the wrapper into
 * an existing layout is safe even for users who have no frame equipped.
 *
 * A11y: the frame is aria-hidden (decorative). The avatar element keeps its
 * `alt` text. Animation respects `prefers-reduced-motion` via the optional
 * `reduce` prop (defaulting to `useReducedMotion()`).
 */
import type { ReactNode } from 'react';
import { useReducedMotion } from 'framer-motion';
import type { FrameId } from '@ruletka/shared-types';
import { cn } from '@/lib/cn';
import { ProfileFrame } from './frame-presets';

export interface AvatarFrameProps {
  /** The equipped frame id, or `null`/unset for no frame. */
  frameId?: FrameId | string | null;
  /** The avatar (or any rounded element) to wrap. */
  children: ReactNode;
  /**
   * Override the prefers-reduced-motion gate. Pass `false` to force motion
   * on (e.g. for a hero preview) or `true` to force it off (e.g. for picker
   * thumbnails so 10 frames don't animate at once).
   */
  reduce?: boolean;
  /** Extra class on the outer wrapper. */
  className?: string;
}

/**
 * Wraps an avatar with the equipped frame's decorative ring. The wrapper is
 * `inline-flex` so it inherits the avatar's positioning rules; the frame
 * layer is absolutely positioned and outset by 16px on each side.
 */
export function AvatarFrame({ frameId, children, reduce, className }: AvatarFrameProps) {
  const prefersReduced = useReducedMotion();
  // If the caller passed `reduce` we honor it; otherwise fall back to the
  // global prefers-reduced-motion preference.
  const motionDisabled = reduce ?? !!prefersReduced;

  return (
    <span className={cn('relative inline-flex', className)}>
      {children}
      {/* Frame ring: outset 16px on each side, sits ABOVE the avatar disk
          but BELOW any interactive overlay the avatar exposes (presence dot,
          camera button). Pointer events are off so clicks fall through. */}
      {frameId && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{
            // 16px on each side ⇒ the frame is 32px taller/wider than the avatar.
            inset: -16,
            zIndex: 1,
          }}
        >
          <ProfileFrame frameId={frameId} animated={!motionDisabled} />
        </span>
      )}
    </span>
  );
}
