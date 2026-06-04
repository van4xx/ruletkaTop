'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/cn';
import { Spinner } from './Spinner';

export const iconButtonVariants = cva(
  [
    'relative inline-flex items-center justify-center',
    'transition-[transform,box-shadow,background-color,color] duration-[var(--duration-fast)]',
    'ease-[var(--ease-out-quart)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50 active:scale-90',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-aurora text-accent-foreground shadow-glow hover:shadow-glow-strong',
        secondary:
          'bg-secondary text-secondary-foreground border border-border hover:bg-background-overlay',
        outline:
          'border border-border-strong text-foreground hover:bg-glass hover:border-accent-muted',
        ghost: 'text-muted-foreground hover:bg-glass hover:text-foreground',
        glass: 'glass text-foreground hover:bg-glass-strong',
        danger: 'bg-danger text-danger-foreground hover:brightness-110 focus-visible:ring-danger',
      },
      size: {
        sm: 'size-9 rounded-lg [&_svg]:size-4',
        md: 'size-11 rounded-xl [&_svg]:size-5',
        lg: 'size-13 rounded-2xl [&_svg]:size-6',
      },
      shape: {
        rounded: '',
        circle: 'rounded-full',
        // A pronounced rounded-square tile — used by the grid layout's big
        // control buttons. Pairs with any `size`; overrides its border-radius.
        square: 'rounded-2xl',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md', shape: 'rounded' },
  },
);

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof iconButtonVariants> {
  asChild?: boolean;
  loading?: boolean;
  /**
   * Required accessible label — icon-only buttons have no text, so this is
   * applied as `aria-label` for screen-reader users.
   */
  'aria-label': string;
}

/**
 * A square/circular button that contains only an icon. Requires `aria-label`
 * for accessibility. Use for video-call controls, toolbar actions, and dense
 * UIs where a text label would be redundant.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    className,
    variant,
    size,
    shape,
    asChild = false,
    loading = false,
    disabled,
    children,
    type,
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  const isDisabled = disabled ?? loading;

  if (asChild) {
    return (
      <Comp
        ref={ref}
        className={cn(iconButtonVariants({ variant, size, shape }), className)}
        {...props}
      >
        {children}
      </Comp>
    );
  }

  return (
    <Comp
      ref={ref}
      type={type ?? 'button'}
      className={cn(iconButtonVariants({ variant, size, shape }), className)}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner size="sm" tone="current" /> : children}
    </Comp>
  );
});
