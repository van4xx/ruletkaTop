'use client';

/**
 * /notifications — the notifications center.
 *
 * Lists the user's notification history (kinds: friend request / message /
 * gift / call / system) with per-kind iconography, relative timestamps,
 * read/unread state, a "Прочитать всё" action and cursor pagination
 * ("Показать ещё"). New items arrive live over the socket (`notif:new`) and are
 * folded into the same cache; tapping a row marks it read on the server.
 *
 * History comes from `GET /notifications` via {@link useNotifications}
 * (TanStack infinite query). Loading / empty / error states are all handled.
 */
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Bell, BellRing, CheckCheck } from 'lucide-react';
import { Button } from '@ruletka/ui';
import { useAuth } from '@/features/auth';
import { useNotifications } from '@/features/notifications/use-notifications';
import { EconomyShell } from '@/components/economy/economy-shell';
import { EmptyState, ErrorState } from '@/components/economy/states';
import { SignInRequired } from '@/components/social/state-views';
import {
  NotificationList,
  NotificationListSkeleton,
} from '@/components/notifications/notification-list';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export default function NotificationsPage() {
  const t = useTranslations('misc');
  const { isAuthenticated, isReady } = useAuth();
  const {
    items,
    unread,
    markRead,
    markAllRead,
    fetchMore,
    hasMore,
    isFetchingMore,
    isLoading,
    isError,
    refetch,
  } = useNotifications();

  const showList = items.length > 0;

  return (
    <EconomyShell
      eyebrow={
        <>
          <BellRing className="h-3.5 w-3.5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
          {t('notifications.eyebrow')}
        </>
      }
      title={
        <>
          {t('notifications.titlePrefix')}{' '}
          <span className="text-gradient-neon">{t('notifications.titleAccent')}</span>
        </>
      }
      lede={t('notifications.lede')}
      actions={
        showList ? (
          <Button
            variant="outline"
            leadingIcon={<CheckCheck className="h-4 w-4" />}
            onClick={markAllRead}
            disabled={unread === 0}
          >
            {t('notifications.markAll')}
            {unread > 0 && (
              <span className="ml-1 rounded-full bg-[var(--color-neon-magenta)]/20 px-1.5 text-xs font-semibold text-[var(--color-neon-magenta)]">
                {unread}
              </span>
            )}
          </Button>
        ) : undefined
      }
    >
      {isReady && !isAuthenticated ? (
        <SignInRequired description={t('notifications.signInDesc')} />
      ) : isError && !showList ? (
        <div className="mx-auto max-w-2xl">
          <ErrorState
            title={t('notifications.errorTitle')}
            description={t('notifications.errorDesc')}
            onRetry={refetch}
          />
        </div>
      ) : isLoading ? (
        <div className="mx-auto max-w-2xl">
          <NotificationListSkeleton count={6} />
        </div>
      ) : !showList ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
        >
          <EmptyState
            icon={<Bell className="h-6 w-6" />}
            title={t('notifications.emptyTitle')}
            description={t('notifications.emptyDesc')}
          />
          <p className="mx-auto mt-4 max-w-md text-center text-xs text-muted-foreground/70">
            {t('notifications.emptyHint')}
          </p>
        </motion.div>
      ) : (
        <div className="mx-auto max-w-2xl space-y-5">
          <NotificationList notifications={items} onRead={markRead} />
          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={fetchMore} loading={isFetchingMore}>
                {t('notifications.showMore')}
              </Button>
            </div>
          )}
        </div>
      )}
    </EconomyShell>
  );
}
