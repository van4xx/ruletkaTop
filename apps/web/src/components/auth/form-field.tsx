'use client';

/**
 * A labelled form-field wrapper: associates a {@link Label} with its control,
 * renders an inline error with `role="alert"`, and wires `aria-describedby` /
 * `aria-invalid` for screen readers. The control is provided via render-prop so
 * the field id + aria attributes are threaded through to any input.
 */
import { useId, type ReactNode } from 'react';
import { Label } from '@ruletka/ui';
import { cn } from '@/lib/cn';

export interface FieldRenderProps {
  id: string;
  invalid: boolean;
  'aria-invalid': boolean | undefined;
  'aria-describedby': string | undefined;
}

export interface FormFieldProps {
  label: ReactNode;
  required?: boolean;
  error?: string;
  /** Optional helper text shown when there is no error. */
  hint?: ReactNode;
  className?: string;
  children: (props: FieldRenderProps) => ReactNode;
}

export function FormField({ label, required, error, hint, className, children }: FormFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const invalid = Boolean(error);
  const describedBy = invalid ? errorId : hint ? hintId : undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {children({
        id,
        invalid,
        'aria-invalid': invalid || undefined,
        'aria-describedby': describedBy,
      })}
      {invalid ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
