'use client';

/**
 * The glass tile that every secondary dashboard widget sits in, plus a shared
 * widget header (icon + title + count badge + optional "see all" link). Keeps
 * the grid visually cohesive without each widget re-implementing chrome.
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

export interface DashboardCardProps {
  children: ReactNode;
  className?: string;
  /** Optional aria-label when the card is a labelled region. */
  label?: string;
  /** Adds extra inner padding (default) or none for edge-to-edge content. */
  padded?: boolean;
}

/** Frosted, rounded tile with a subtle top sheen — the widget container. */
export function DashboardCard({ children, className, label, padded = true }: DashboardCardProps) {
  return (
    <section
      aria-label={label}
      className={cn(
        'glass-panel relative overflow-hidden rounded-3xl',
        padded && 'p-5 sm:p-6',
        className,
      )}
    >
      {/* Hairline sheen along the top edge for depth. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent"
      />
      {children}
    </section>
  );
}

export interface WidgetHeaderProps {
  icon: ReactNode;
  title: ReactNode;
  /** Accent color for the icon chip (CSS color or var). Defaults to violet. */
  accent?: string;
  /** Small count chip rendered after the title (e.g. unread). */
  count?: number | null;
  /** Optional "see all" link target. */
  href?: string;
  /** Visible label for the link (defaults to the shared "All" label). */
  linkLabel?: string;
  className?: string;
}

export function WidgetHeader({
  icon,
  title,
  accent = 'var(--color-neon-violet)',
  count,
  href,
  linkLabel,
  className,
}: WidgetHeaderProps) {
  const t = useTranslations('misc');
  const resolvedLinkLabel = linkLabel ?? t('dashboard.widgetAll');
  return (
    <header className={cn('mb-4 flex items-center justify-between gap-3', className)}>
      <h2 className="flex min-w-0 items-center gap-2.5">
        <span
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1 ring-border/70"
          style={{
            color: accent,
            backgroundColor: `color-mix(in oklch, ${accent} 14%, transparent)`,
          }}
        >
          {icon}
        </span>
        <span className="truncate font-display text-base font-bold tracking-tight">{title}</span>
        {count != null && count > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-neon-magenta)]/20 px-1.5 text-[0.6875rem] font-bold tabular-nums text-[var(--color-neon-magenta)]">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </h2>

      {href && (
        <Link
          href={href}
          className="group inline-flex shrink-0 items-center gap-0.5 rounded-lg text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {resolvedLinkLabel}
          <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      )}
    </header>
  );
}
