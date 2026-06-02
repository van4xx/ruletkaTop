import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/cn';

const skeletonVariants = cva('relative overflow-hidden bg-muted/60', {
  variants: {
    shape: {
      line: 'rounded-md',
      block: 'rounded-xl',
      circle: 'rounded-full',
    },
  },
  defaultVariants: { shape: 'line' },
});

export interface SkeletonProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof skeletonVariants> {}

/**
 * A loading placeholder with a brand-tinted shimmer sweep. The shimmer respects
 * `prefers-reduced-motion` (animation is neutralized globally). Marked
 * `aria-hidden` since it conveys no information to assistive tech.
 */
export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton(
  { className, shape, ...props },
  ref,
) {
  return (
    <div ref={ref} aria-hidden="true" className={cn(skeletonVariants({ shape }), className)} {...props}>
      <div
        className="absolute inset-0 animate-shimmer bg-[length:200%_100%]"
        style={{
          backgroundImage:
            'linear-gradient(90deg, transparent 0%, var(--glass-highlight) 50%, transparent 100%)',
        }}
      />
    </div>
  );
});
