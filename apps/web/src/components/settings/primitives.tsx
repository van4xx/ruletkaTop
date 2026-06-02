'use client';

/**
 * Shared layout primitives for the settings tabs, so every section reads the
 * same: a titled glass card, label/description rows with a right-aligned
 * control, and a styled native `<select>` (the design system ships no select
 * primitive; a native control keeps it accessible + mobile-friendly).
 */
import { forwardRef, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Label } from '@ruletka/ui';
import { cn } from '@/lib/cn';

/** A titled section card. */
export function SettingsSection({
  title,
  description,
  icon,
  children,
  footer,
  className,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('glass-panel rounded-2xl', className)}>
      <header className="flex items-start gap-3 border-b border-border/60 px-5 py-4 sm:px-6">
        {icon && (
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-card/70 text-[var(--color-neon-violet)] ring-1 ring-border/70 [&_svg]:h-4.5 [&_svg]:w-4.5">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      </header>
      <div className="px-5 py-5 sm:px-6">{children}</div>
      {footer && (
        <footer className="flex items-center justify-end gap-3 border-t border-border/60 px-5 py-4 sm:px-6">
          {footer}
        </footer>
      )}
    </section>
  );
}

/** A label + optional description on the left, control on the right. */
export function SettingRow({
  label,
  htmlFor,
  description,
  control,
  className,
  stacked = false,
}: {
  label: ReactNode;
  htmlFor?: string;
  description?: ReactNode;
  control: ReactNode;
  className?: string;
  /** Force the control below the label (used by wider inputs). */
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex gap-4 py-3.5 first:pt-0 last:pb-0',
        stacked ? 'flex-col' : 'flex-col sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0 space-y-0.5">
        {htmlFor ? (
          <Label htmlFor={htmlFor}>{label}</Label>
        ) : (
          <span className="text-sm font-medium text-foreground">{label}</span>
        )}
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className={cn('shrink-0', stacked && 'w-full')}>{control}</div>
    </div>
  );
}

/** Divider between rows within a section. */
export function RowDivider() {
  return <hr className="border-border/50" />;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  options: ReadonlyArray<SelectOption>;
}

/** A native `<select>` styled to match the Input primitive. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, className, ...props },
  ref,
) {
  return (
    <div className="relative inline-flex w-full min-w-[9rem] items-center sm:w-auto">
      <select
        ref={ref}
        className={cn(
          'h-11 w-full appearance-none rounded-xl border border-border bg-input/40 pl-3.5 pr-9 text-sm text-foreground',
          'transition-[border-color,box-shadow,background-color] duration-200',
          'hover:border-border focus-visible:border-[var(--color-neon-violet)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-55',
          className,
        )}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 h-4 w-4 text-muted-foreground"
        aria-hidden="true"
      />
    </div>
  );
});
