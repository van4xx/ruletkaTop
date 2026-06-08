'use client';

/**
 * Notifications preview — the newest slice of the user's notifications, backed
 * by the real history (`GET /notifications`) and kept live over the socket
 * (`notif:new`); see {@link useNotificationsPreview}. Each kind gets a tinted
 * icon; new items animate in. The "Отметить прочитанным" action calls the real
 * read-all endpoint and clears the unread counter.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useLocale, useTranslations } from 'next-intl';
import { Bell, BellRing, Gift, MessageCircle, Phone, Sparkles, UserPlus } from 'lucide-react';
import type { AppNotification } from '@ruletka/shared-types';
import type { LucideIcon } from 'lucide-react';
import { Skeleton } from '@ruletka/ui';
import { formatRelativeTime } from '@/components/notifications/notification-meta';
import { useNotificationsPreview } from '@/hooks/dashboard/use-notifications-preview';
import { ErrorState } from '@/components/economy/states';
import { DashboardCard, WidgetHeader } from './dashboard-card';

interface KindStyle {
  icon: LucideIcon;
  color: string;
}

const KIND: Record<AppNotification['kind'], KindStyle> = {
  friend_request: { icon: UserPlus, color: 'var(--color-neon-cyan)' },
  message: { icon: MessageCircle, color: 'var(--color-neon-violet)' },
  gift: { icon: Gift, color: 'var(--color-neon-magenta)' },
  call: { icon: Phone, color: 'var(--success)' },
  system: { icon: Sparkles, color: 'var(--warning)' },
};

export function NotificationsWidget() {
  const t = useTranslations('misc');
  const locale = useLocale();
  const { items, unread, isLoading, isError, refetch, markAllRead } = useNotificationsPreview();

  return (
    <DashboardCard label={t('dashboard.notificationsLabel')}>
      <WidgetHeader
        icon={
          unread > 0 ? (
            <BellRing className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Bell className="h-4 w-4" aria-hidden="true" />
          )
        }
        accent="var(--warning)"
        title={t('dashboard.notificationsTitle')}
        count={unread > 0 ? unread : null}
      />

      {isError ? (
        <ErrorState
          title={t('dashboard.notificationsErrorTitle')}
          description={t('dashboard.notificationsErrorDesc')}
          onRetry={refetch}
        />
      ) : isLoading ? (
        <ul className="-mx-2 space-y-0.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex items-start gap-3 rounded-2xl p-2">
              <Skeleton className="h-8 w-8 shrink-0 rounded-xl" />
              <div className="flex-1 space-y-2 pt-0.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-44" />
              </div>
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/70 py-7 text-center">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-card/60 text-muted-foreground ring-1 ring-border/60">
            <Bell className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="max-w-[14rem] text-sm text-muted-foreground">
            {t('dashboard.notificationsEmpty')}
          </p>
        </div>
      ) : (
        <>
          <ul className="-mx-2 space-y-0.5">
            <AnimatePresence initial={false}>
              {items.map((n) => {
                const style = KIND[n.kind] ?? KIND.system;
                const Icon = style.icon;
                return (
                  <motion.li
                    key={n.id}
                    layout
                    initial={{ opacity: 0, height: 0, y: -8 }}
                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className="flex items-start gap-3 rounded-2xl p-2"
                  >
                    <span
                      className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1 ring-border/60"
                      style={{
                        color: style.color,
                        backgroundColor: `color-mix(in oklch, ${style.color} 14%, transparent)`,
                      }}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-semibold">{n.title}</p>
                        <span className="shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums">
                          {formatRelativeTime(n.createdAt, t, locale)}
                        </span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{n.body}</p>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>

          {unread > 0 && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={markAllRead}
                className="rounded-lg text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {t('dashboard.markRead')}
              </button>
            </div>
          )}
        </>
      )}
    </DashboardCard>
  );
}
