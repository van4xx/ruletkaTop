'use client';

import * as React from 'react';

import { cn } from '../lib/cn';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Marks the field as invalid (red border + ring). Sets `aria-invalid`. */
  invalid?: boolean;
}

/**
 * A multi-line text field, styled to match {@link Input}. Defaults to
 * vertical-only resize. Use for bios, gift messages, and report details.
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid = false, rows = 4, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex w-full resize-y rounded-xl border bg-input/40 px-3.5 py-2.5 text-sm text-foreground',
        'transition-[border-color,box-shadow,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out-quart)]',
        'placeholder:text-subtle-foreground',
        'focus:border-accent-muted focus:bg-input/60 focus:outline-none focus:ring-2 focus:ring-input-focus',
        'disabled:cursor-not-allowed disabled:opacity-55',
        invalid
          ? 'border-danger focus:border-danger focus:ring-danger/40'
          : 'border-border',
        className,
      )}
      {...props}
    />
  );
});
