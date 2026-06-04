'use client';

/**
 * Shared presentational state views for the social surfaces (friends, chats,
 * profile). Centralising loading / empty / error / unauthenticated states keeps
 * every page consistent and on-brand without duplicating markup.
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { AlertTriangle, LogIn, RefreshCw } from 'lucide-react';
import { Button } from '@ruletka/ui';
import { cn } from '@/lib/cn';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** A centered glass panel used by empty / error / sign-in states. */
export function StatePanel({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
      className={cn(
        'glass-panel mx-auto flex max-w-md flex-col items-center gap-4 rounded-3xl px-8 py-12 text-center',
        className,
      )}
    >
      {icon && (
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-card/70 text-[var(--color-neon-violet)] ring-1 ring-border/70">
          {icon}
        </span>
      )}
      <div className="space-y-1.5">
        <h2 className="font-display text-lg font-bold tracking-tight">{title}</h2>
        {description && <p className="text-pretty text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </motion.div>
  );
}

/** Standard "something went wrong" panel with a retry button. */
export function ErrorState({
  title,
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  const t = useTranslations('social');
  return (
    <StatePanel
      icon={<AlertTriangle className="h-7 w-7 text-[var(--color-neon-magenta)]" />}
      title={title ?? t('somethingWentWrong')}
      description={description ?? t('loadDataError')}
      action={
        onRetry && (
          <Button
            variant="outline"
            size="sm"
            leadingIcon={<RefreshCw className="h-4 w-4" />}
            onClick={onRetry}
          >
            {t('retry')}
          </Button>
        )
      }
    />
  );
}

/** Shown when an authenticated session is required but absent. */
export function SignInRequired({ description }: { description?: string }) {
  const t = useTranslations('social');
  return (
    <StatePanel
      icon={<LogIn className="h-7 w-7" />}
      title={t('signInRequiredTitle')}
      description={description ?? t('signInRequiredDescription')}
      action={
        <Button asChild variant="primary" size="sm">
          <Link href="/">{t('goHome')}</Link>
        </Button>
      }
    />
  );
}
