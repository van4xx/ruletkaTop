import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/cn';

const spinnerVariants = cva('inline-block animate-spin-slow rounded-full border-solid', {
  variants: {
    size: {
      xs: 'size-3 border-[1.5px]',
      sm: 'size-4 border-2',
      md: 'size-6 border-2',
      lg: 'size-8 border-[3px]',
    },
    tone: {
      current: 'border-current border-r-transparent',
      accent: 'border-accent border-r-transparent',
      muted: 'border-muted-foreground border-r-transparent',
    },
  },
  defaultVariants: { size: 'md', tone: 'current' },
});

export interface SpinnerProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof spinnerVariants> {
  /** Accessible label announced to screen readers. Defaults to "Loading". */
  label?: string;
}

/**
 * A lightweight, CSS-only loading spinner. Honors `prefers-reduced-motion`
 * (the spin animation is neutralized globally for reduced-motion users) and
 * exposes an accessible label via a visually-hidden span.
 */
export const Spinner = React.forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { className, size, tone, label = 'Loading', role = 'status', ...props },
  ref,
) {
  return (
    <span ref={ref} role={role} className={cn('inline-flex', className)} {...props}>
      <span className={spinnerVariants({ size, tone })} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
});
