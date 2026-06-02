'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as React from 'react';

import { cn } from '../lib/cn';

/**
 * Tooltip built on Radix Tooltip. Wrap your app (or a subtree) in
 * {@link TooltipProvider} once to share open/close delays, then use
 * `Tooltip` + `TooltipTrigger` + `TooltipContent`.
 *
 * @example
 * <TooltipProvider>
 *   <Tooltip>
 *     <TooltipTrigger asChild><IconButton aria-label="Mute"><MicOff/></IconButton></TooltipTrigger>
 *     <TooltipContent>Mute microphone</TooltipContent>
 *   </Tooltip>
 * </TooltipProvider>
 */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & {
    /** Show the little arrow pointing at the trigger. */
    withArrow?: boolean;
  }
>(function TooltipContent({ className, sideOffset = 6, withArrow = true, children, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'z-[var(--z-tooltip)] max-w-xs rounded-lg px-2.5 py-1.5 text-xs font-medium',
          'glass-strong text-foreground shadow-lg',
          'origin-[var(--radix-tooltip-content-transform-origin)]',
          'data-[state=delayed-open]:animate-popover-in data-[state=closed]:animate-popover-out',
          className,
        )}
        {...props}
      >
        {children}
        {withArrow && <TooltipPrimitive.Arrow className="fill-glass-strong" width={11} height={6} />}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
});
