'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/cn';
import { Spinner } from './Spinner';

/**
 * Button variants.
 *
 * - `primary`   — the aurora gradient CTA, the product's hero action.
 * - `secondary` — calm neutral surface for medium-emphasis actions.
 * - `outline`   — bordered, transparent; pairs with glass surfaces.
 * - `ghost`     — text-only until hovered; for toolbars and dense UIs.
 * - `glass`     — frosted translucent button for overlays / video controls.
 * - `danger`    — destructive actions (block, report, delete).
 * - `link`      — inline, underline-on-hover text action.
 */
export const buttonVariants = cva(
  [
    'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap',
    'font-medium leading-none',
    'transition-[transform,box-shadow,background-color,color,opacity] duration-[var(--duration-fast)]',
    'ease-[var(--ease-out-quart)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
    'active:scale-[0.97]',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: [
          'bg-aurora text-accent-foreground shadow-glow',
          'hover:shadow-glow-strong hover:brightness-110',
        ],
        secondary: [
          'bg-secondary text-secondary-foreground border border-border',
          'hover:bg-background-overlay hover:border-border-strong',
        ],
        outline: [
          'border border-border-strong bg-transparent text-foreground',
          'hover:bg-glass hover:border-accent-muted',
        ],
        ghost: ['bg-transparent text-muted-foreground', 'hover:bg-glass hover:text-foreground'],
        glass: ['glass text-foreground', 'hover:bg-glass-strong hover:border-accent-muted'],
        danger: [
          'bg-danger text-danger-foreground shadow-sm',
          'hover:brightness-110 focus-visible:ring-danger',
        ],
        link: [
          'bg-transparent text-accent underline-offset-4 hover:underline',
          'h-auto p-0 active:scale-100',
        ],
      },
      size: {
        sm: 'h-9 rounded-md px-3.5 text-sm [&_svg]:size-4',
        md: 'h-11 rounded-lg px-5 text-sm [&_svg]:size-4',
        lg: 'h-13 rounded-xl px-7 text-base [&_svg]:size-5',
        xl: 'h-15 rounded-2xl px-9 text-lg [&_svg]:size-5',
      },
      block: {
        true: 'w-full',
      },
    },
    compoundVariants: [
      // `link` variant ignores size paddings/heights.
      { variant: 'link', size: ['sm', 'md', 'lg', 'xl'], class: 'h-auto rounded-none px-0' },
    ],
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /**
   * Render as the single child element (Radix `Slot`) instead of a `<button>`,
   * so the button styles can be applied to a link or another control.
   */
  asChild?: boolean;
  /** Shows a spinner, sets `aria-busy`, and disables interaction. */
  loading?: boolean;
  /** Icon rendered before the label. */
  leadingIcon?: React.ReactNode;
  /** Icon rendered after the label. */
  trailingIcon?: React.ReactNode;
}

/**
 * The primary action element of the design system.
 *
 * Defaults to the on-brand aurora gradient. Supports `asChild` for polymorphic
 * rendering (e.g. wrapping a Next.js `<Link>`), a built-in `loading` state, and
 * leading/trailing icon slots. Press feedback uses a subtle scale; focus uses
 * the shared accent ring.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    block,
    asChild = false,
    loading = false,
    disabled,
    leadingIcon,
    trailingIcon,
    children,
    type,
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  const isDisabled = disabled ?? loading;

  // With `asChild`, Radix Slot requires exactly one child element, so we must
  // not inject sibling spinner/icon nodes; pass the child through untouched.
  if (asChild) {
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, block }), className)}
        aria-busy={loading || undefined}
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
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        // Overlaid so the label below reserves the button's width (no reflow).
        <span className="absolute inset-0 inline-flex items-center justify-center">
          <Spinner size="sm" tone="current" label="Loading" />
        </span>
      )}
      <span className={cn('inline-flex items-center gap-2', loading && 'invisible')}>
        {leadingIcon}
        {children}
        {trailingIcon}
      </span>
    </Comp>
  );
});
