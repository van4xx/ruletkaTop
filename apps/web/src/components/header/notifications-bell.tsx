'use client';

/**
 * Notifications bell — a glass icon button with a live unread badge and a
 * popover preview of the latest events.
 *
 * Data comes from {@link useNotificationsPreview}: the newest slice of the real
 * notifications history (`GET /notifications`), with the unread badge from the
 * authoritative server count, both kept live over the `notif:new` socket event.
 * Opening the panel marks everything read on the server (clears the badge).
 *
 * a11y: the trigger is a real button with `aria-expanded`/`aria-haspopup` and a
 * count baked into its label; the panel is a labelled `dialog` with `Escape` to
 * close and outside-click dismissal (see {@link usePopover}). Mounted only for
 * authenticated users (the parent gates it), so the socket subscription never
 * runs for anonymous visitors.
 */
import { memo, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Bell,
  BellRing,
  Gift,
  MessageCircle,
  Phone,
  Sparkles,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import type { AppNotification } from '@ruletka/shared-types';
import { ROUTES } from '@/config/nav';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/features/chat/lib/format';
import { useNotificationsPreview } from '@/hooks/dashboard/use-notifications-preview';
import { usePopover } from './use-popover';

const KIND: Record<AppNotification['kind'], { icon: LucideIcon; color: string }> = {
  friend_request: { icon: UserPlus, color: 'var(--color-neon-cyan)' },
  message: { icon: MessageCircle, color: 'var(--color-neon-violet)' },
  gift: { icon: Gift, color: 'var(--color-neon-magenta)' },
  call: { icon: Phone, color: 'var(--success)' },
  system: { icon: Sparkles, color: 'var(--warning)' },
};

function NotificationsBellImpl() {
  const t = useTranslations('chrome');
  const { items, unread, markAllRead } = useNotificationsPreview();
  const { open, toggle, close, triggerRef, panelRef } = usePopover();
  const reduceMotion = useReducedMotion();

  // Opening the panel acknowledges the unread items.
  useEffect(() => {
    if (open && unread > 0) markAllRead();
  }, [open, unread, markAllRead]);

  const badge = unread > 99 ? '99+' : String(unread);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          unread > 0
            ? t('notifications.triggerAriaCount', { count: unread })
            : t('notifications.triggerAria')
        }
        className={cn(
          'relative inline-flex h-9 w-9 items-center justify-center rounded-full',
          'border border-border/70 bg-card/40 text-muted-foreground backdrop-blur',
          'outline-none transition-colors hover:bg-card/70 hover:text-foreground',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          open && 'bg-card/70 text-foreground',
        )}
      >
        {unread > 0 ? (
          <BellRing className="h-[1.05rem] w-[1.05rem]" aria-hidden="true" />
        ) : (
          <Bell className="h-[1.05rem] w-[1.05rem]" aria-hidden="true" />
        )}
        <AnimatePresence>
          {unread > 0 && (
            <motion.span
              key="badge"
              initial={reduceMotion ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              exit={reduceMotion ? undefined : { scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              aria-hidden="true"
              className={cn(
                'absolute -right-0.5 -top-0.5 inline-flex h-[1.1rem] min-w-[1.1rem] items-center justify-center rounded-full px-1',
                'bg-gradient-to-br from-[var(--color-neon-magenta)] to-[var(--color-neon-violet)]',
                'text-[0.625rem] font-bold leading-none text-white',
                'ring-2 ring-background',
              )}
            >
              {badge}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-label={t('notifications.panelAria')}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: 'top right' }}
            className={cn(
              'absolute right-0 top-[calc(100%+0.6rem)] z-[var(--z-overlay,1000)] w-[min(20rem,calc(100vw-2rem))]',
              'glass-panel overflow-hidden rounded-2xl shadow-xl',
            )}
          >
            <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
              <p className="font-display text-sm font-bold">{t('notifications.title')}</p>
              {unread > 0 && (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[0.65rem] font-semibold text-primary tabular-nums">
                  {t('notifications.unreadBadge', { count: unread })}
                </span>
              )}
            </div>

            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-9 text-center">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-card/60 text-muted-foreground ring-1 ring-border/60">
                  <Bell className="h-5 w-5" aria-hidden="true" />
                </span>
                <p className="max-w-[14rem] text-sm text-muted-foreground">
                  {t('notifications.empty')}
                </p>
              </div>
            ) : (
              <ul className="max-h-[min(20rem,50vh)] divide-y divide-border/50 overflow-y-auto">
                {items.map((n) => {
                  const style = KIND[n.kind] ?? KIND.system;
                  const Icon = style.icon;
                  return (
                    <li key={n.id}>
                      <div className="flex items-start gap-3 px-4 py-3">
                        <span
                          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1 ring-border/60"
                          style={{
                            color: style.color,
                            backgroundColor: `color-mix(in oklch, ${style.color} 14%, transparent)`,
                          }}
                          aria-hidden="true"
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="truncate text-sm font-semibold">{n.title}</p>
                            <span className="shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums">
                              {formatRelativeTime(n.createdAt)}
                            </span>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{n.body}</p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="border-t border-border/70 p-2">
              <Link
                href={ROUTES.notifications}
                onClick={close}
                className={cn(
                  'flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium',
                  'text-foreground/90 outline-none transition-colors hover:bg-accent-soft',
                  'focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                {t('notifications.viewAll')}
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const NotificationsBell = memo(NotificationsBellImpl);
