'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/cn';

const inputWrapperVariants = cva(
  [
    'group relative flex items-center gap-2 rounded-xl border bg-input/40 text-foreground',
    'transition-[border-color,box-shadow,background-color] duration-[var(--duration-fast)]',
    'ease-[var(--ease-out-quart)]',
    'focus-within:border-accent-muted focus-within:bg-input/60',
    'focus-within:ring-2 focus-within:ring-input-focus focus-within:ring-offset-0',
  ],
  {
    variants: {
      invalid: {
        true: 'border-danger focus-within:border-danger focus-within:ring-danger/40',
        false: 'border-border',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-3.5 text-sm',
        lg: 'h-13 px-4 text-base',
      },
      disabled: {
        true: 'cursor-not-allowed opacity-55',
        false: '',
      },
    },
    defaultVariants: { invalid: false, size: 'md', disabled: false },
  },
);

export interface InputProps
  extends
    Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    Pick<VariantProps<typeof inputWrapperVariants>, 'size'> {
  /** Marks the field as invalid (red border + ring). Sets `aria-invalid`. */
  invalid?: boolean;
  /** Adornment rendered inside the field, before the input (e.g. an icon). */
  leadingIcon?: React.ReactNode;
  /** Adornment rendered inside the field, after the input. */
  trailingIcon?: React.ReactNode;
  /** Class names applied to the outer wrapper (icons + input). */
  wrapperClassName?: string;
}

/**
 * A single-line text field. Renders a styled wrapper (so leading/trailing
 * icons sit inside the bordered control) around a borderless native `<input>`,
 * keeping the full native input API intact. Focus shows the accent ring;
 * `invalid` switches to the danger palette and sets `aria-invalid`.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    className,
    wrapperClassName,
    invalid = false,
    size,
    disabled,
    leadingIcon,
    trailingIcon,
    ...props
  },
  ref,
) {
  return (
    <div className={cn(inputWrapperVariants({ invalid, size, disabled }), wrapperClassName)}>
      {leadingIcon && (
        <span className="pointer-events-none flex shrink-0 text-muted-foreground [&_svg]:size-4">
          {leadingIcon}
        </span>
      )}
      <input
        ref={ref}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className={cn(
          'peer h-full w-full bg-transparent text-foreground outline-none',
          'placeholder:text-subtle-foreground',
          'disabled:cursor-not-allowed',
          // Hide spin buttons on number inputs for a cleaner look.
          '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          className,
        )}
        {...props}
      />
      {trailingIcon && (
        <span className="flex shrink-0 text-muted-foreground [&_svg]:size-4">{trailingIcon}</span>
      )}
    </div>
  );
});
