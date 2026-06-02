'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/cn';

export const cardVariants = cva('relative overflow-hidden rounded-2xl text-foreground', {
  variants: {
    variant: {
      /** Frosted translucent surface — the product's signature container. */
      glass: 'glass',
      /** Solid elevated panel for content-dense areas. */
      solid: 'bg-background-elevated border border-border shadow-md',
      /** Bordered, transparent — quiet grouping without a fill. */
      outline: 'border border-border bg-transparent',
      /** Gradient-bordered glass — for premium / featured cards. */
      aurora: 'glass border-aurora',
    },
    interactive: {
      true: [
        'cursor-pointer transition-[transform,box-shadow,border-color] duration-[var(--duration-base)]',
        'ease-[var(--ease-out-quart)] hover:-translate-y-0.5 hover:shadow-lg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      ],
    },
    padding: {
      none: 'p-0',
      sm: 'p-4',
      md: 'p-6',
      lg: 'p-8',
    },
  },
  defaultVariants: { variant: 'glass', interactive: false, padding: 'md' },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

/**
 * A surface container. Defaults to the frosted `glass` look; switch to `solid`
 * for dense content, `outline` for quiet grouping, or `aurora` to feature an
 * item with a gradient border. Set `interactive` to add hover lift + focus ring
 * (remember to also add `tabIndex`/`role` when used as a clickable element).
 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, variant, interactive, padding, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(cardVariants({ variant, interactive, padding }), className)}
      {...props}
    />
  );
});

/** Alias for the signature frosted card with explicit `glass` variant. */
export const GlassCard = React.forwardRef<HTMLDivElement, Omit<CardProps, 'variant'>>(
  function GlassCard(props, ref) {
    return <Card ref={ref} variant="glass" {...props} />;
  },
);

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className, ...props }, ref) {
    return <div ref={ref} className={cn('mb-4 flex flex-col gap-1.5', className)} {...props} />;
  },
);

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(function CardTitle({ className, ...props }, ref) {
  return (
    <h3
      ref={ref}
      className={cn('font-display text-lg font-semibold tracking-tight', className)}
      {...props}
    />
  );
});

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function CardDescription({ className, ...props }, ref) {
  return <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />;
});

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className, ...props }, ref) {
    return <div ref={ref} className={cn('text-sm', className)} {...props} />;
  },
);

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...props }, ref) {
    return <div ref={ref} className={cn('mt-6 flex items-center gap-3', className)} {...props} />;
  },
);
