'use client';

/**
 * The notifications feed: a glass list of {@link StoredNotification} rows
 * grouped under "Сегодня / Ранее" headers. Unread rows carry an aurora accent
 * rail + dot; tapping a row marks it read and (when the kind has a target)
 * navigates there. Live additions are animated with framer-motion. A row may
 * optionally expose a dismiss control when the caller provides `onRemove`.
 */
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Check, X } from 'lucide-react';
import { IconButton, Skeleton } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import type { StoredNotification } from '@/features/notifications/store';
import { NOTIFICATION_META, formatRelativeTime } from './notification-meta';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function NotificationRow({
  notification,
  onRead,
  onRemove,
}: {
  notification: StoredNotification;
  onRead: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  const t = useTranslations('misc');
  const meta = NOTIFICATION_META[notification.kind];
  const Icon = meta.icon;
  const { read } = notification;
  // Prefer the server-provided deep link, falling back to the per-kind target.
  const href = notification.link ?? meta.href;

  const inner = (
    <>
      {/* Unread accent rail. */}
      {!read && (
        <span
          aria-hidden="true"
          className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-aurora"
        />
      )}
      <span
        className={cn(
          'relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
          meta.chip,
        )}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p
            className={cn(
              'truncate text-sm',
              read ? 'font-medium text-foreground/90' : 'font-semibold text-foreground',
            )}
          >
            {notification.title}
          </p>
          {!read && (
            <span
              aria-label={t('notifications.unread')}
              className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-neon-cyan)] shadow-[0_0_6px_var(--color-neon-cyan)]"
            />
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{notification.body}</p>
        <p className="mt-1 text-xs text-muted-foreground/80">
          {t(meta.labelKey)} · {formatRelativeTime(notification.createdAt, t)}
        </p>
      </div>
    </>
  );

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
      className="group relative"
    >
      <div
        className={cn(
          'relative flex items-start gap-3.5 rounded-2xl p-3.5 transition-colors sm:p-4',
          read ? 'hover:bg-card/40' : 'bg-card/30 hover:bg-card/50',
        )}
      >
        {href ? (
          <Link
            href={href}
            onClick={() => onRead(notification.id)}
            className="flex flex-1 items-start gap-3.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {inner}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onRead(notification.id)}
            className="flex flex-1 items-start gap-3.5 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {inner}
          </button>
        )}

        <div className="flex shrink-0 items-center gap-1 self-center">
          {!read && (
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={t('notifications.markReadAria')}
              title={t('notifications.markReadAria')}
              onClick={() => onRead(notification.id)}
              className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Check aria-hidden="true" />
            </IconButton>
          )}
          {onRemove && (
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={t('notifications.removeAria')}
              title={t('notifications.removeTitle')}
              onClick={() => onRemove(notification.id)}
              className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            >
              <X aria-hidden="true" />
            </IconButton>
          )}
        </div>
      </div>
    </motion.li>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <li className="px-3.5 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground/80 first:pt-0 sm:px-4">
      {children}
    </li>
  );
}

export function NotificationList({
  notifications,
  onRead,
  onRemove,
}: {
  notifications: StoredNotification[];
  onRead: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  const t = useTranslations('misc');
  const today = notifications.filter((n) => isToday(n.createdAt));
  const earlier = notifications.filter((n) => !isToday(n.createdAt));

  return (
    <div className="glass-panel overflow-hidden rounded-2xl p-1.5 sm:p-2">
      <ul>
        <AnimatePresence initial={false}>
          {today.length > 0 && <GroupHeading key="today-h">{t('notifications.groupToday')}</GroupHeading>}
          {today.map((n) => (
            <NotificationRow
              key={n.id}
              notification={n}
              onRead={onRead}
              onRemove={onRemove}
            />
          ))}
          {earlier.length > 0 && <GroupHeading key="earlier-h">{t('notifications.groupEarlier')}</GroupHeading>}
          {earlier.map((n) => (
            <NotificationRow
              key={n.id}
              notification={n}
              onRead={onRead}
              onRemove={onRemove}
            />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

/** Matching skeleton for the feed's initial load. */
export function NotificationListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="glass-panel overflow-hidden rounded-2xl p-1.5 sm:p-2" aria-hidden="true">
      <ul>
        {Array.from({ length: count }).map((_, i) => (
          <li key={i} className="flex items-start gap-3.5 rounded-2xl p-3.5 sm:p-4">
            <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
