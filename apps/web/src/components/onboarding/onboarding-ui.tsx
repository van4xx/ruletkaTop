'use client';

/**
 * Small presentational building blocks shared by the onboarding steps: a step
 * heading, a selectable "chip" (pill toggle), and a larger selectable option
 * card (used for gender). Kept here so every step looks consistent.
 */
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Title + subtitle for a step's content panel. */
export function StepHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="text-center sm:text-left">
      <h2 className="font-display text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
      {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

/** A pill-shaped multi/single select toggle. */
export function SelectChip({
  selected,
  onClick,
  children,
  className,
  ...rest
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'>) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium ring-1 transition-all',
        selected
          ? 'bg-[var(--color-neon-cyan)]/15 text-foreground ring-[var(--color-neon-cyan)]/50'
          : 'bg-card/50 text-foreground/90 ring-border/60 hover:ring-border',
        className,
      )}
      {...rest}
    >
      {selected && (
        <Check className="h-3.5 w-3.5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
      )}
      {children}
    </button>
  );
}

/** A larger card-style radio option (icon + label), used for gender. */
export function OptionCard({
  selected,
  onClick,
  icon,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'flex flex-1 flex-col items-center gap-2 rounded-2xl px-4 py-5 ring-1 transition-all',
        selected
          ? 'bg-[var(--color-neon-violet)]/15 text-foreground ring-[var(--color-neon-violet)]/50 shadow-[0_4px_20px_-8px_var(--color-neon-violet)]'
          : 'bg-card/50 text-foreground/90 ring-border/60 hover:ring-border',
      )}
    >
      <span
        className={cn(
          'inline-flex h-11 w-11 items-center justify-center rounded-xl transition-colors',
          selected ? 'bg-primary/20 text-primary' : 'bg-card/70 text-muted-foreground',
        )}
      >
        {icon}
      </span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}
