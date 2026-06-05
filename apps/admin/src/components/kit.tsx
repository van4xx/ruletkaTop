/**
 * Admin design kit — "Midnight Aurora" primitives for the admin panel.
 * ─────────────────────────────────────────────────────────────────────────
 * Polished, dark-theme, dependency-free building blocks every admin page (and
 * every Wave-2 section) composes. They build on the shared `@ruletka/ui` tokens
 * + glass/aurora utilities and the existing `pages/ui.tsx` helpers (re-exported
 * here so a page imports the whole kit from one place).
 *
 * Charts are hand-rolled SVG (line / bar / sparkline) — no chart dependency —
 * so the bundle stays lean and the visuals stay on-brand.
 */
import { Fragment, useEffect, useId, useState, type ReactNode } from 'react';
import { Button, Spinner } from '@ruletka/ui';

import { fmtDate, fmtInt } from '../pages/ui';

// Re-export the original helpers so pages can `import { ... } from '../components/kit'`.
export { PageTitle, StatCard, fmtCoins, fmtDate, fmtInt } from '../pages/ui';

/* ───────────────────────────── small class helper ─────────────────────────── */
/** Join truthy class names (local mirror of `cn` to avoid an import cycle). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ───────────────────────────────── PageHeader ─────────────────────────────── */
export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Optional right-aligned actions (buttons, filters). */
  actions?: ReactNode;
}

/** Section page heading with subtitle + an actions slot. */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ─────────────────────────────────── Card ─────────────────────────────────── */
export interface CardProps {
  children: ReactNode;
  className?: string;
  /** Tighten or remove the default padding. */
  padding?: 'none' | 'sm' | 'md';
}

/** The signature glass surface used as a section container. */
export function Card({ children, className, padding = 'md' }: CardProps) {
  const pad = padding === 'none' ? '' : padding === 'sm' ? 'p-4' : 'p-5';
  return (
    <div className={cx('glass-strong rounded-2xl ring-1 ring-border/50', pad, className)}>
      {children}
    </div>
  );
}

/** Optional card header row (title + actions) for sectioned cards. */
export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
      <h2 className="font-display text-base font-semibold">{title}</h2>
      {action}
    </div>
  );
}

/* ────────────────────────────────── Badge ─────────────────────────────────── */
export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'accent';

const BADGE_CLASS: Record<BadgeVariant, string> = {
  success: 'bg-success/15 text-success ring-success/30',
  warning: 'bg-warning/15 text-warning ring-warning/30',
  danger: 'bg-danger/15 text-danger ring-danger/30',
  info: 'bg-info/15 text-info ring-info/30',
  accent: 'bg-accent-muted text-accent ring-accent/30',
  muted: 'bg-glass text-muted-foreground ring-border/60',
};

/** Compact status pill with semantic variants. */
export function Badge({
  children,
  variant = 'muted',
  className,
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1',
        BADGE_CLASS[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ───────────────────────────────── MetricCard ─────────────────────────────── */
export interface MetricCardProps {
  label: string;
  value: ReactNode;
  /** Signed % or count delta vs the previous period. */
  delta?: number;
  /** Spark series rendered as a tiny inline sparkline. */
  spark?: number[];
  hint?: string;
  loading?: boolean;
  accent?: boolean;
}

/** A KPI tile: label, big value, optional delta chip + sparkline. */
export function MetricCard({ label, value, delta, spark, hint, loading, accent }: MetricCardProps) {
  const positive = (delta ?? 0) >= 0;
  return (
    <div
      className={cx(
        'glass-strong rounded-2xl p-5 ring-1',
        accent ? 'ring-accent-muted' : 'ring-border/50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {delta !== undefined && !loading && (
          <span
            className={cx(
              'shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
              positive ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger',
            )}
          >
            {positive ? '+' : ''}
            {delta}%
          </span>
        )}
      </div>
      {loading ? (
        <div className="mt-3 h-7 w-24 animate-pulse rounded-md bg-glass" />
      ) : (
        <p
          className={cx(
            'mt-1.5 font-display text-2xl font-bold tabular-nums',
            accent && 'text-accent',
          )}
        >
          {value}
        </p>
      )}
      {spark && spark.length > 1 && !loading && (
        <div className="mt-2 h-8">
          <Sparkline data={spark} />
        </div>
      )}
      {hint && !loading && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* ──────────────────────────────── Money / Coins ───────────────────────────── */
/** Render a RUB amount (ru-RU grouping, ₽ suffix). */
export function Money({ amount, currency = '₽' }: { amount: number; currency?: string }) {
  return (
    <span className="tabular-nums">
      {fmtInt(amount)} {currency}
    </span>
  );
}

/** Render a coin amount with the product's "мон." suffix. */
export function Coins({ amount, signed }: { amount: number; signed?: boolean }) {
  const sign = signed && amount > 0 ? '+' : '';
  return (
    <span className={cx('tabular-nums', signed && (amount >= 0 ? 'text-success' : 'text-danger'))}>
      {sign}
      {fmtInt(amount)} мон.
    </span>
  );
}

/* ──────────────────────────────── RelativeTime ────────────────────────────── */
const RT_DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
];
const RT_FMT = new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto' });

/** A relative timestamp ("5 минут назад") with the absolute date on hover. */
export function RelativeTime({ iso }: { iso: string }) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return <span className="text-muted-foreground">—</span>;
  let duration = (d.getTime() - Date.now()) / 1000;
  let label = RT_FMT.format(0, 'second');
  for (const division of RT_DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      label = RT_FMT.format(Math.round(duration), division.unit);
      break;
    }
    duration /= division.amount;
  }
  return (
    <span title={fmtDate(iso)} className="tabular-nums text-muted-foreground">
      {label}
    </span>
  );
}

/* ─────────────────────────────────── Avatar ───────────────────────────────── */
/** A monogram avatar (deterministic hue from the seed). Keeps the kit self-contained. */
export function Avatar({
  seed,
  label,
  size = 'md',
}: {
  seed?: string;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const dim =
    size === 'sm' ? 'size-8 text-xs' : size === 'lg' ? 'size-12 text-base' : 'size-10 text-sm';
  const initial = (label ?? seed ?? '?').trim().charAt(0).toUpperCase() || '?';
  const hue = hashHue(seed ?? label ?? '?');
  return (
    <span
      className={cx('grid shrink-0 place-items-center rounded-full font-semibold text-white', dim)}
      style={{
        background: `linear-gradient(135deg, oklch(0.62 0.18 ${hue}), oklch(0.55 0.2 ${(hue + 40) % 360}))`,
      }}
      aria-hidden
    >
      {initial}
    </span>
  );
}

/** Stable 0..359 hue from a string seed. */
function hashHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

/* ──────────────────────────────── EmptyState ──────────────────────────────── */
export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      {icon && <div className="mb-3 text-muted-foreground/70">{icon}</div>}
      <p className="font-display text-base font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ───────────────────────────────── Toolbar ────────────────────────────────── */
export interface ToolbarProps {
  /** Bound search value. Omit to hide the search input. */
  search?: string;
  onSearch?: (value: string) => void;
  searchPlaceholder?: string;
  /** Extra filter controls (selects, toggles) shown after the search. */
  filters?: ReactNode;
  /** Right-aligned actions. */
  actions?: ReactNode;
}

/** A search + filters + actions row above a table. */
export function Toolbar({
  search,
  onSearch,
  searchPlaceholder = 'Поиск…',
  filters,
  actions,
}: ToolbarProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {onSearch && (
        <div className="min-w-56 flex-1">
          <input
            type="search"
            value={search ?? ''}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded-lg border border-border bg-background-elevated px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-accent"
          />
        </div>
      )}
      {filters}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A styled `<select>` consistent with the admin theme (for Toolbar filters). */
export function Select({
  value,
  onChange,
  children,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cx(
        'h-9 rounded-lg border border-border bg-background-elevated px-3 text-sm text-foreground outline-none transition-colors focus:border-accent',
        className,
      )}
    >
      {children}
    </select>
  );
}

/* ───────────────────────────────── DataTable ──────────────────────────────── */
export interface Column<T> {
  /** Stable key (also used as React key for the cell). */
  key: string;
  header: ReactNode;
  /** Cell renderer for a row. */
  render: (row: T) => ReactNode;
  /** Right-align (numbers/actions). */
  align?: 'left' | 'right';
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  /** Stable row id for React keys + click handling. */
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: ReactNode;
  /** Rendered when there are no rows (and not loading/error). */
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  /** Optional footer (e.g. a <Pagination/>), rendered under the table. */
  footer?: ReactNode;
}

/**
 * The workhorse table: columns + rows with loading / error / empty states,
 * optional row-click, and a footer slot for pagination. Generic over the row
 * shape so each page passes its own typed rows.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  empty,
  onRowClick,
  footer,
}: DataTableProps<T>) {
  return (
    <Card padding="none" className="overflow-hidden">
      {loading ? (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      ) : error ? (
        <p className="p-8 text-center text-sm text-danger">{error}</p>
      ) : rows.length === 0 ? (
        (empty ?? <EmptyState title="Ничего не найдено" />)
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={cx('px-4 py-3 font-medium', c.align === 'right' && 'text-right')}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cx(
                    'transition-colors hover:bg-glass/40',
                    onRowClick && 'cursor-pointer',
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cx('px-4 py-3', c.align === 'right' && 'text-right', c.className)}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {footer && <div className="border-t border-border/60 px-4 py-3">{footer}</div>}
    </Card>
  );
}

/* ──────────────────────────────── Pagination ──────────────────────────────── */
/**
 * Cursor-style pager: a "load more" affordance plus a loaded-count readout.
 * (Most admin lists are cursor-paginated; this matches that model. A page-number
 * variant can be added in Wave 2 if a list ever needs random access.)
 */
export function Pagination({
  hasMore,
  loading,
  loadedCount,
  onLoadMore,
}: {
  hasMore: boolean;
  loading?: boolean;
  loadedCount: number;
  onLoadMore: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">Загружено {fmtInt(loadedCount)}</span>
      {hasMore ? (
        <Button variant="ghost" size="sm" loading={loading} onClick={onLoadMore}>
          Показать ещё
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">Это всё</span>
      )}
    </div>
  );
}

/* ─────────────────────────────────── Tabs ─────────────────────────────────── */
export interface TabItem {
  key: string;
  label: ReactNode;
}

/** Pill tab bar (controlled). The signature aurora pill marks the active tab. */
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {items.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cx(
            'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
            value === t.key
              ? 'bg-aurora text-white'
              : 'bg-glass text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ────────────────────────────── Modal / Dialog ────────────────────────────── */
/**
 * A centered modal dialog. Closes on backdrop click or Escape. Body scroll is
 * locked while open. Built directly (not via Radix) to stay light + predictable.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth = 'max-w-md',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
}) {
  useLockBody(open);
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background-overlay/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          'w-full glass-strong rounded-2xl p-6 shadow-xl ring-1 ring-border/60',
          maxWidth,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <h2 className="mb-4 font-display text-lg font-bold">{title}</h2>}
        <div>{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/* ─────────────────────────────────── Drawer ───────────────────────────────── */
/** A right-side detail panel. Closes on backdrop click or Escape. */
export function Drawer({
  open,
  onClose,
  title,
  children,
  width = 'max-w-md',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  useLockBody(open);
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-background-overlay/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        className={cx(
          'flex h-full w-full flex-col overflow-y-auto border-l border-border bg-background-elevated p-6 shadow-xl',
          width,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-2">
          {title && <h2 className="font-display text-lg font-bold">{title}</h2>}
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-glass hover:text-foreground"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="flex-1">{children}</div>
      </aside>
    </div>
  );
}

/* ──────────────────────────────── ConfirmButton ───────────────────────────── */
/**
 * A destructive/confirming action button that pops a confirmation modal before
 * firing `onConfirm`. Keeps dangerous admin actions a deliberate two-step.
 */
export function ConfirmButton({
  children,
  onConfirm,
  confirmTitle = 'Подтвердите действие',
  confirmBody,
  confirmLabel = 'Подтвердить',
  variant = 'danger',
  size = 'sm',
  loading,
  disabled,
}: {
  children: ReactNode;
  onConfirm: () => void;
  confirmTitle?: string;
  confirmBody?: ReactNode;
  confirmLabel?: string;
  variant?: 'danger' | 'primary' | 'secondary';
  size?: 'sm' | 'md';
  loading?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        loading={loading}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {children}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={confirmTitle}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button
              variant={variant}
              size="sm"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          {confirmBody ?? 'Это действие нельзя отменить. Продолжить?'}
        </p>
      </Modal>
    </>
  );
}

/* ════════════════════════════════════ Charts ═══════════════════════════════ */
/** Shared point shape for the line + bar charts. */
export interface ChartPoint {
  label: string;
  value: number;
}

/** Map a series to an array of `[x, y]` SVG coords inside a viewbox. */
function project(values: number[], w: number, h: number, pad: number): Array<[number, number]> {
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const step = values.length > 1 ? innerW / (values.length - 1) : 0;
  return values.map((v, i) => {
    const x = pad + i * step;
    const y = pad + innerH - ((v - min) / span) * innerH;
    return [x, y];
  });
}

/** A tiny inline sparkline (no axes) for metric tiles. */
export function Sparkline({ data, className }: { data: number[]; className?: string }) {
  const w = 120;
  const h = 32;
  const pts = project(data, w, h, 2);
  const d = pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  const last = pts.at(-1);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cx('h-full w-full', className)}
    >
      <path
        d={d}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      {last && <circle cx={last[0]} cy={last[1]} r={1.8} fill="var(--accent)" />}
    </svg>
  );
}

/** A full line chart with a soft gradient fill + sparse value grid. */
export function LineChart({ data, height = 220 }: { data: ChartPoint[]; height?: number }) {
  const gid = useId().replace(/:/g, '');
  if (data.length === 0) return <EmptyState title="Нет данных" />;
  const w = 600;
  const h = height;
  const pad = 24;
  const values = data.map((d) => d.value);
  const pts = project(values, w, h, pad);
  const line = pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  const first = pts[0];
  const lastP = pts.at(-1);
  const area =
    first && lastP
      ? `${line} L${lastP[0].toFixed(1)} ${h - pad} L${first[0].toFixed(1)} ${h - pad} Z`
      : '';
  const max = Math.max(1, ...values);

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-auto w-full"
        style={{ aspectRatio: `${w} / ${h}` }}
      >
        <defs>
          <linearGradient id={`la-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={pad}
            x2={w - pad}
            y1={pad + (h - pad * 2) * f}
            y2={pad + (h - pad * 2) * f}
            stroke="var(--border)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {area && <path d={area} fill={`url(#la-${gid})`} />}
        <path
          d={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{data[0]?.label}</span>
        <span className="tabular-nums">макс {fmtInt(max)}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
    </div>
  );
}

/** A vertical bar chart (categorical). */
export function BarChart({ data, height = 220 }: { data: ChartPoint[]; height?: number }) {
  if (data.length === 0) return <EmptyState title="Нет данных" />;
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="w-full">
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((d, i) => (
          <div
            key={`${d.label}-${i}`}
            className="group flex flex-1 flex-col items-center justify-end"
          >
            <span className="mb-1 text-[10px] tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
              {fmtInt(d.value)}
            </span>
            <div
              className="w-full rounded-t bg-aurora transition-all"
              style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? 2 : 0 }}
              title={`${d.label}: ${fmtInt(d.value)}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{data[0]?.label}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
    </div>
  );
}

/** Unified chart entry point — pick line or bar by `kind`. */
export function Chart({
  kind,
  data,
  height,
}: {
  kind: 'line' | 'bar';
  data: ChartPoint[];
  height?: number;
}) {
  return kind === 'bar' ? (
    <BarChart data={data} height={height} />
  ) : (
    <LineChart data={data} height={height} />
  );
}

/* ─────────────────────────────── shared hooks ─────────────────────────────── */
/** Lock body scroll while `active`. */
function useLockBody(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

/** Fire `onEscape` on the Escape key while `active`. */
function useEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, onEscape]);
}

/** Debounce a value by `ms` (handy for Toolbar search). */
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Re-export Fragment so consumers needn't import React directly. */
export { Fragment };
