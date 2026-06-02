'use client';

/**
 * Shared loading / empty / error presentational states for the economy pages,
 * styled to the product's glass aesthetic. Keeps every feature's async surface
 * consistent (and avoids re-implementing skeleton grids four times).
 */
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { motion, type Variants } from 'framer-motion';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button, Skeleton } from '@ruletka/ui';
import { cn } from '@/lib/cn';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Shared, gentle entrance for the inline state panels (matches the house feel). */
const panelIn: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.985 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, ease: EASE_OUT } },
};

/** A responsive grid of glass skeleton cards with a soft staggered fade-in. */
export function CardGridSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div
      className={cn('grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3', className)}
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, ease: EASE_OUT, delay: Math.min(i, 8) * 0.05 }}
          className="glass-panel rounded-2xl p-6"
        >
          <Skeleton className="h-12 w-12 rounded-xl" />
          <Skeleton className="mt-5 h-6 w-2/3" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-4/5" />
          <Skeleton className="mt-6 h-11 w-full rounded-lg" />
        </motion.div>
      ))}
    </div>
  );
}

/** Inline error panel with a retry affordance. */
export function ErrorState({
  title,
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useTranslations('economy');
  const tc = useTranslations('common');
  return (
    <motion.div
      role="alert"
      variants={panelIn}
      initial="hidden"
      animate="show"
      className={cn(
        'glass-panel flex flex-col items-center gap-4 rounded-2xl px-6 py-14 text-center',
        className,
      )}
    >
      <span className="relative inline-flex h-12 w-12 items-center justify-center rounded-full bg-destructive/15 text-destructive">
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-destructive/15 motion-safe:animate-ping"
        />
        <AlertTriangle className="relative h-6 w-6" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <h3 className="font-display text-lg font-bold">{title ?? t('states.errorTitle')}</h3>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          {description ?? t('states.errorDescription')}
        </p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" leadingIcon={<RefreshCw className="h-4 w-4" />} onClick={onRetry}>
          {tc('retry')}
        </Button>
      )}
    </motion.div>
  );
}

/** Friendly empty state with an optional illustration glyph + action slot. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={panelIn}
      initial="hidden"
      animate="show"
      className={cn(
        'glass-panel flex flex-col items-center gap-4 rounded-2xl px-6 py-16 text-center',
        className,
      )}
    >
      {icon && (
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary">
          {icon}
        </span>
      )}
      <div className="space-y-1.5">
        <h3 className="font-display text-lg font-bold">{title}</h3>
        {description && (
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </motion.div>
  );
}
