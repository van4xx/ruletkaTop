'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
// lucide-react 1.0 renamed the circle/triangle icons (e.g. XCircle → CircleX);
// use the canonical 1.x names so the imports resolve without relying on aliases.
import { CircleCheckBig, CircleX, Info, TriangleAlert, X } from 'lucide-react';
import * as React from 'react';

import { cn } from '../lib/cn';

export type ToastVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

export interface ToastOptions {
  id?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  /** Auto-dismiss after this many ms. `0`/`Infinity` keeps it until closed. */
  duration?: number;
  /** Optional inline action (e.g. "Undo"). */
  action?: { label: string; onClick: () => void };
}

interface ToastEntry extends Required<Pick<ToastOptions, 'id' | 'variant' | 'duration'>> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastOptions['action'];
}

// ───────────────────────── External store (no provider needed) ─────────────────────────
// A tiny module-level pub/sub so `toast(...)` can be called from anywhere
// (event handlers, async callbacks, non-React code) without prop drilling.

type Listener = (toasts: ToastEntry[]) => void;

let toasts: ToastEntry[] = [];
const listeners = new Set<Listener>();
let count = 0;

function emit() {
  for (const listener of listeners) listener(toasts);
}

function addToast(options: ToastOptions): string {
  const id = options.id ?? `toast-${++count}`;
  const entry: ToastEntry = {
    id,
    variant: options.variant ?? 'default',
    duration: options.duration ?? 5000,
    title: options.title,
    description: options.description,
    action: options.action,
  };
  // Replace if an id collides; otherwise prepend (newest on top).
  toasts = [entry, ...toasts.filter((t) => t.id !== id)].slice(0, 5);
  emit();
  return id;
}

function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/**
 * Imperatively show a toast from anywhere. Returns the toast id (useful to
 * dismiss it early). Convenience methods cover the semantic variants.
 *
 * ```ts
 * toast.success('Gift sent!');
 * toast({ title: 'Match found', description: 'Connecting…', duration: 3000 });
 * ```
 */
export const toast = Object.assign(
  (options: ToastOptions | string) =>
    addToast(typeof options === 'string' ? { title: options } : options),
  {
    success: (title: React.ReactNode, options?: Omit<ToastOptions, 'title' | 'variant'>) =>
      addToast({ ...options, title, variant: 'success' }),
    warning: (title: React.ReactNode, options?: Omit<ToastOptions, 'title' | 'variant'>) =>
      addToast({ ...options, title, variant: 'warning' }),
    danger: (title: React.ReactNode, options?: Omit<ToastOptions, 'title' | 'variant'>) =>
      addToast({ ...options, title, variant: 'danger' }),
    error: (title: React.ReactNode, options?: Omit<ToastOptions, 'title' | 'variant'>) =>
      addToast({ ...options, title, variant: 'danger' }),
    info: (title: React.ReactNode, options?: Omit<ToastOptions, 'title' | 'variant'>) =>
      addToast({ ...options, title, variant: 'info' }),
    dismiss: dismissToast,
  },
);

/** Subscribe to the live toast list (used internally by {@link Toaster}). */
export function useToasts(): ToastEntry[] {
  const [state, setState] = React.useState<ToastEntry[]>(toasts);
  React.useEffect(() => {
    listeners.add(setState);
    setState(toasts);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}

// ───────────────────────────────── Presentation ────────────────────────────────────

const variantConfig: Record<
  ToastVariant,
  { icon: React.ComponentType<{ className?: string }>; accent: string }
> = {
  default: { icon: Info, accent: 'text-accent' },
  success: { icon: CircleCheckBig, accent: 'text-success' },
  warning: { icon: TriangleAlert, accent: 'text-warning' },
  danger: { icon: CircleX, accent: 'text-danger' },
  info: { icon: Info, accent: 'text-info' },
};

const POSITIONS = {
  'top-right': 'top-0 right-0 items-end',
  'top-center': 'top-0 left-1/2 -translate-x-1/2 items-center',
  'top-left': 'top-0 left-0 items-start',
  'bottom-right': 'bottom-0 right-0 items-end',
  'bottom-center': 'bottom-0 left-1/2 -translate-x-1/2 items-center',
  'bottom-left': 'bottom-0 left-0 items-start',
} as const;

export interface ToasterProps {
  /** Where the stack docks. Defaults to bottom-right. */
  position?: keyof typeof POSITIONS;
}

/**
 * Mount once near the root of the app. Renders the live toast stack with
 * spring enter/exit motion (reduced-motion aware), an accessible live region,
 * per-toast auto-dismiss timers, and an inline action slot.
 */
export function Toaster({ position = 'bottom-right' }: ToasterProps) {
  const items = useToasts();
  const reduceMotion = useReducedMotion();
  const isTop = position.startsWith('top');

  return (
    <div
      // Polite live region so screen readers announce new toasts.
      role="region"
      aria-live="polite"
      aria-label="Notifications"
      className={cn(
        'pointer-events-none fixed z-[var(--z-toast)] flex w-full max-w-sm flex-col gap-3 p-4',
        POSITIONS[position],
      )}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {items.map((t) => (
          <ToastCard key={t.id} toast={t} reduceMotion={!!reduceMotion} fromTop={isTop} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastCard({
  toast: t,
  reduceMotion,
  fromTop,
}: {
  toast: ToastEntry;
  reduceMotion: boolean;
  fromTop: boolean;
}) {
  const { icon: Icon, accent } = variantConfig[t.variant];

  React.useEffect(() => {
    if (!t.duration || t.duration === Infinity) return;
    const timer = window.setTimeout(() => dismissToast(t.id), t.duration);
    return () => window.clearTimeout(timer);
  }, [t.id, t.duration]);

  const offset = fromTop ? -16 : 16;

  return (
    <motion.div
      layout
      // Danger/error toasts interrupt (assertive); the rest defer to the
      // surrounding polite live region. `alert` carries an implicit
      // aria-live="assertive"; `status` is polite.
      role={t.variant === 'danger' ? 'alert' : 'status'}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: offset, scale: 0.96 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, x: 24 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className={cn(
        'pointer-events-auto flex w-full items-start gap-3 rounded-xl p-4',
        'glass-strong shadow-lg',
      )}
    >
      <Icon className={cn('mt-0.5 size-5 shrink-0', accent)} aria-hidden="true" />
      <div className="flex-1 space-y-0.5">
        {t.title && <p className="text-sm font-semibold leading-snug text-foreground">{t.title}</p>}
        {t.description && (
          <p className="text-sm leading-snug text-muted-foreground">{t.description}</p>
        )}
        {t.action && (
          <button
            type="button"
            onClick={() => {
              t.action?.onClick();
              dismissToast(t.id);
            }}
            className="mt-1.5 text-sm font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismissToast(t.id)}
        aria-label="Dismiss notification"
        className="-m-1 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" />
      </button>
    </motion.div>
  );
}
