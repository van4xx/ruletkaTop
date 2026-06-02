'use client';

import * as SliderPrimitive from '@radix-ui/react-slider';
import * as React from 'react';

import { cn } from '../lib/cn';

export interface SliderProps extends React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  /**
   * Render a value bubble above each thumb. Supply a formatter to customize the
   * displayed text (e.g. `(v) => \`${v} yrs\``). Great for an age-range filter.
   */
  showValues?: boolean;
  formatValue?: (value: number) => React.ReactNode;
}

/**
 * A slider built on Radix Slider. Renders one thumb per value, so it supports
 * both single-value and **two-thumb range** usage (e.g. an 18–60 age filter):
 *
 * ```tsx
 * <Slider min={18} max={80} step={1} defaultValue={[18, 35]} showValues
 *   formatValue={(v) => `${v}`} aria-label="Age range" />
 * ```
 *
 * Fully keyboard-operable (arrows, Home/End, Page Up/Down) and themed with the
 * aurora gradient on the active range.
 */
export const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  function Slider(
    {
      className,
      showValues = false,
      formatValue = (v: number) => v,
      value,
      defaultValue,
      min = 0,
      max = 100,
      ...props
    },
    ref,
  ) {
    // Determine the number of thumbs from the controlled/uncontrolled value, so
    // a two-element array yields a two-thumb range slider automatically.
    const resolved = value ?? defaultValue ?? [min];
    const thumbValues = Array.isArray(resolved) ? resolved : [resolved];

    return (
      <SliderPrimitive.Root
        ref={ref}
        value={value}
        defaultValue={defaultValue}
        min={min}
        max={max}
        className={cn(
          'relative flex w-full touch-none select-none items-center',
          showValues && 'pt-7',
          'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
          className,
        )}
        {...props}
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
          <SliderPrimitive.Range className="absolute h-full bg-aurora" />
        </SliderPrimitive.Track>
        {thumbValues.map((thumbValue, index) => (
          <SliderPrimitive.Thumb
            // Index is the stable identity here: thumb order never reorders.
            key={index}
            className={cn(
              'group relative block size-5 rounded-full border-2 border-accent bg-background-elevated shadow-md',
              'transition-[transform,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out-back)]',
              'hover:scale-110 hover:shadow-glow',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            {showValues && (
              <span
                className={cn(
                  'absolute -top-8 left-1/2 -translate-x-1/2 rounded-md bg-background-overlay px-1.5 py-0.5',
                  'text-xs font-semibold tabular-nums text-foreground shadow-sm',
                  'border border-border',
                )}
              >
                {formatValue(thumbValue)}
              </span>
            )}
          </SliderPrimitive.Thumb>
        ))}
      </SliderPrimitive.Root>
    );
  },
);
