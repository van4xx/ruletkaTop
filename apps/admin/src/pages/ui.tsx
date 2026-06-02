/**
 * Small presentational helpers shared across the admin pages. These keep the
 * page modules lean and the styling consistent with the existing glass/aurora
 * dark design used by the Shell.
 */
import type { ReactNode } from 'react';

/** Page heading + optional subtitle. Mirrors the original App.tsx header. */
export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

/** A single dashboard/economy metric tile. */
export function StatCard({
  label,
  value,
  hint,
  loading,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  loading?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={`glass-strong rounded-2xl p-5 ring-1 ${
        accent ? 'ring-accent-muted' : 'ring-border/50'
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {loading ? (
        <div className="mt-3 h-7 w-20 animate-pulse rounded-md bg-glass" />
      ) : (
        <p className={`mt-1.5 font-display text-2xl font-bold tabular-nums ${accent ? 'text-accent' : ''}`}>{value}</p>
      )}
      {hint && !loading && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Compact thousands-grouped integer (ru-RU spacing). */
export function fmtInt(n: number): string {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n));
}

/** Coin amount with a ₵-style suffix kept consistent with the product. */
export function fmtCoins(n: number): string {
  return `${fmtInt(n)} мон.`;
}

/** Short relative-ish date for ledger rows / created-at columns. */
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}
