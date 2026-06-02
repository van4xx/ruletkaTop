import * as React from 'react';

import { cn } from '../lib/cn';

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Renders a subtle accent asterisk to mark a required field. */
  required?: boolean;
}

/**
 * A form label. Associate it with a control via `htmlFor`. The `required`
 * flag appends an accent-colored asterisk with an accessible "required" hint.
 */
export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { className, required, children, ...props },
  ref,
) {
  return (
    <label
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 text-sm font-medium leading-none text-foreground',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
        className,
      )}
      {...props}
    >
      {children}
      {required && (
        <span className="text-accent" aria-hidden="true">
          *<span className="sr-only">required</span>
        </span>
      )}
    </label>
  );
});
