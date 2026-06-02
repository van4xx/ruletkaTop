'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/cn';

/**
 * Tabs built on Radix Tabs (roving focus, arrow-key navigation, automatic
 * activation). Two looks: a frosted `pill` segmented control and a minimal
 * `underline` row. The active state uses the accent palette.
 */
export const Tabs = TabsPrimitive.Root;

const tabsListVariants = cva('inline-flex items-center', {
  variants: {
    variant: {
      pill: 'gap-1 rounded-xl glass p-1',
      underline: 'gap-1 border-b border-border',
    },
    block: { true: 'flex w-full', false: '' },
  },
  defaultVariants: { variant: 'pill', block: false },
});

const TabsVariantContext = React.createContext<'pill' | 'underline'>('pill');

export interface TabsListProps
  extends
    React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>,
    VariantProps<typeof tabsListVariants> {}

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(function TabsList({ className, variant = 'pill', block, ...props }, ref) {
  return (
    <TabsVariantContext.Provider value={variant ?? 'pill'}>
      <TabsPrimitive.List
        ref={ref}
        className={cn(tabsListVariants({ variant, block }), className)}
        {...props}
      />
    </TabsVariantContext.Provider>
  );
});

const triggerVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium',
    'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out-quart)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
    'text-muted-foreground hover:text-foreground',
    '[&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        pill: 'flex-1 rounded-lg px-3.5 py-2 data-[state=active]:bg-aurora data-[state=active]:text-accent-foreground data-[state=active]:shadow-glow',
        underline:
          'rounded-none px-3.5 pb-3 pt-2 data-[state=active]:text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-aurora after:opacity-0 data-[state=active]:after:opacity-100',
      },
    },
    defaultVariants: { variant: 'pill' },
  },
);

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  const variant = React.useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(triggerVariants({ variant }), className)}
      {...props}
    />
  );
});

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn(
        'mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'data-[state=active]:animate-overlay-in',
        className,
      )}
      {...props}
    />
  );
});
