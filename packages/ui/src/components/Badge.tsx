import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/cn';

export const badgeVariants = cva(
  [
    'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium leading-none',
    'border transition-colors duration-[var(--duration-fast)]',
    '[&_svg]:size-3 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        neutral: 'border-border bg-secondary text-secondary-foreground',
        accent: 'border-accent-muted bg-accent-soft text-accent',
        aurora: 'border-transparent bg-aurora text-accent-foreground shadow-sm',
        outline: 'border-border-strong bg-transparent text-foreground',
        success: 'border-transparent bg-success/15 text-success',
        warning: 'border-transparent bg-warning/15 text-warning',
        danger: 'border-transparent bg-danger/15 text-danger',
        coin: 'border-coin/30 bg-coin/15 text-coin',
        // Rarity tiers for gifts/cosmetics.
        common: 'border-rarity-common/30 bg-rarity-common/12 text-rarity-common',
        rare: 'border-rarity-rare/30 bg-rarity-rare/15 text-rarity-rare',
        epic: 'border-rarity-epic/30 bg-rarity-epic/15 text-rarity-epic',
        legendary: 'border-rarity-legendary/40 bg-rarity-legendary/15 text-rarity-legendary',
      },
      size: {
        sm: 'h-5 px-2 text-[0.6875rem]',
        md: 'h-6 px-2.5 text-xs',
        lg: 'h-7 px-3 text-sm',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Shows a small leading status dot in the current text color. */
  dot?: boolean;
}

/**
 * A small status/label pill. Includes semantic variants (success/warning/
 * danger), the on-brand `accent`/`aurora` looks, a `coin` treatment for the
 * economy, and the four `rarity` tiers used by gifts and cosmetics.
 */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant, size, dot, children, ...props },
  ref,
) {
  return (
    <span ref={ref} className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
});
