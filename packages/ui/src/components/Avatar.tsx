'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import type { OnlineStatus } from '@ruletka/shared-types';

import { cn } from '../lib/cn';

const avatarVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted align-middle',
  {
    variants: {
      size: {
        xs: 'size-6 text-[0.625rem]',
        sm: 'size-8 text-xs',
        md: 'size-10 text-sm',
        lg: 'size-14 text-base',
        xl: 'size-20 text-xl',
      },
      ring: {
        none: '',
        accent: 'ring-2 ring-accent ring-offset-2 ring-offset-background',
        aurora: 'ring-2 ring-transparent ring-offset-2 ring-offset-background',
      },
    },
    defaultVariants: { size: 'md', ring: 'none' },
  },
);

const statusColor: Record<OnlineStatus, string> = {
  online: 'bg-success',
  offline: 'bg-subtle-foreground',
  in_call: 'bg-accent',
  away: 'bg-warning',
};

const statusDotSize: Record<NonNullable<VariantProps<typeof avatarVariants>['size']>, string> = {
  xs: 'size-1.5',
  sm: 'size-2',
  md: 'size-2.5',
  lg: 'size-3.5',
  xl: 'size-4',
};

export interface AvatarProps
  extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>,
    VariantProps<typeof avatarVariants> {
  /** Image URL. Falls back to initials/icon if missing or it errors. */
  src?: string | null;
  /** Alt text for the image (and source of generated initials). */
  alt?: string;
  /** Explicit fallback content; defaults to initials derived from `alt`. */
  fallback?: React.ReactNode;
  /** Presence indicator dot. Maps to the shared `OnlineStatus` palette. */
  status?: OnlineStatus;
}

function initialsFrom(name?: string): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('');
}

/**
 * User avatar built on Radix Avatar (graceful image-load fallback). Supports
 * sizes, an optional accent/aurora ring (for premium/featured users), and a
 * presence dot wired to the shared `OnlineStatus` type.
 */
export const Avatar = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Root>, AvatarProps>(
  function Avatar({ className, size, ring, src, alt, fallback, status, ...props }, ref) {
    const computedFallback = fallback ?? initialsFrom(alt);
    const safeSize = size ?? 'md';
    return (
      <span className="relative inline-flex">
        <AvatarPrimitive.Root
          ref={ref}
          className={cn(
            avatarVariants({ size, ring }),
            ring === 'aurora' && 'bg-aurora p-0.5',
            className,
          )}
          {...props}
        >
          {ring === 'aurora' ? (
            <span className="flex size-full items-center justify-center overflow-hidden rounded-full bg-background">
              <AvatarInner src={src} alt={alt} fallback={computedFallback} />
            </span>
          ) : (
            <AvatarInner src={src} alt={alt} fallback={computedFallback} />
          )}
        </AvatarPrimitive.Root>
        {status && (
          <span
            className={cn(
              'absolute bottom-0 right-0 rounded-full ring-2 ring-background',
              statusDotSize[safeSize],
              statusColor[status],
              status === 'online' && 'animate-pulse-glow',
            )}
            aria-label={status.replace('_', ' ')}
            role="status"
          />
        )}
      </span>
    );
  },
);

function AvatarInner({
  src,
  alt,
  fallback,
}: {
  src?: string | null;
  alt?: string;
  fallback: React.ReactNode;
}) {
  return (
    <>
      {src && (
        <AvatarPrimitive.Image src={src} alt={alt ?? ''} className="size-full object-cover" />
      )}
      <AvatarPrimitive.Fallback
        delayMs={src ? 300 : 0}
        className="flex size-full items-center justify-center font-semibold text-muted-foreground"
      >
        {fallback || <span aria-hidden="true">?</span>}
      </AvatarPrimitive.Fallback>
    </>
  );
}

/** A clustered row of avatars with overlap — for "people in room" displays. */
export interface AvatarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  max?: number;
  size?: VariantProps<typeof avatarVariants>['size'];
}

export function AvatarGroup({ className, children, max = 4, size = 'sm', ...props }: AvatarGroupProps) {
  const items = React.Children.toArray(children);
  const visible = items.slice(0, max);
  const overflow = items.length - visible.length;

  return (
    <div className={cn('flex items-center -space-x-2.5', className)} {...props}>
      {visible.map((child, i) => (
        <span key={i} className="rounded-full ring-2 ring-background">
          {child}
        </span>
      ))}
      {overflow > 0 && (
        <span
          className={cn(
            avatarVariants({ size }),
            'ring-2 ring-background bg-secondary font-semibold text-secondary-foreground',
          )}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
