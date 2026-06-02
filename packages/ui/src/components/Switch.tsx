'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/cn';

const switchVariants = cva(
  [
    'peer inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent',
    'transition-colors duration-[var(--duration-base)] ease-[var(--ease-out-quart)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'data-[state=checked]:bg-aurora data-[state=checked]:shadow-glow',
    'data-[state=unchecked]:bg-muted',
  ],
  {
    variants: {
      size: {
        sm: 'h-5 w-9',
        md: 'h-6 w-11',
        lg: 'h-7 w-[3.25rem]',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

const thumbVariants = cva(
  [
    'pointer-events-none block rounded-full bg-white shadow-sm ring-0',
    'transition-transform duration-[var(--duration-base)] ease-[var(--ease-out-back)]',
    'data-[state=unchecked]:translate-x-0.5',
  ],
  {
    variants: {
      size: {
        sm: 'size-4 data-[state=checked]:translate-x-[1.125rem]',
        md: 'size-5 data-[state=checked]:translate-x-[1.375rem]',
        lg: 'size-6 data-[state=checked]:translate-x-[1.5rem]',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>,
    VariantProps<typeof switchVariants> {}

/**
 * A toggle switch built on Radix Switch. On = the aurora gradient with a soft
 * glow; the thumb travels with a gentle spring. Pair with a {@link Label}
 * (via `id`/`htmlFor`) for an accessible, clickable label.
 */
export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(function Switch({ className, size, ...props }, ref) {
  return (
    <SwitchPrimitive.Root ref={ref} className={cn(switchVariants({ size }), className)} {...props}>
      <SwitchPrimitive.Thumb className={thumbVariants({ size })} />
    </SwitchPrimitive.Root>
  );
});
