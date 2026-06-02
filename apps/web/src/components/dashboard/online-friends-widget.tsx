'use client';

/**
 * Online-friends strip: a horizontally scrollable row of friends who are
 * reachable right now (online / away / in-call), each with a live presence dot
 * and quick deep-links to message or video-call them. Driven by
 * `useOnlineFriends` (friends list + live socket presence).
 */
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { MessageCircle, UserPlus, Users, Video } from 'lucide-react';
import type { FriendSummary, OnlineStatus } from '@ruletka/shared-types';
import { Avatar, Skeleton } from '@ruletka/ui';
import { ROUTES } from '@/config/nav';
import { cn } from '@/lib/cn';
import { useOnlineFriends } from '@/hooks/dashboard/use-dashboard';
import { ErrorState } from '@/components/economy/states';
import { DashboardCard, WidgetHeader } from './dashboard-card';

/** Maps an online status to its `misc.dashboard.*` label key. */
const STATUS_LABEL_KEY: Partial<Record<OnlineStatus, string>> = {
  online: 'dashboard.statusOnline',
  away: 'dashboard.statusAway',
  in_call: 'dashboard.statusInCall',
};

export function OnlineFriendsWidget() {
  const t = useTranslations('misc');
  const { online, total, presence, isLoading, isError, refetch } = useOnlineFriends();
  const onlineCount = online.length;

  return (
    <DashboardCard label={t('dashboard.friendsLabel')}>
      <WidgetHeader
        icon={<Users className="h-4 w-4" aria-hidden="true" />}
        accent="var(--color-neon-cyan)"
        title={t('dashboard.friendsTitle')}
        count={onlineCount > 0 ? onlineCount : null}
        href={ROUTES.friends}
      />

      {isError ? (
        <ErrorState
          title={t('dashboard.friendsErrorTitle')}
          description={t('dashboard.friendsErrorDesc')}
          onRetry={refetch}
        />
      ) : isLoading ? (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex w-20 shrink-0 flex-col items-center gap-2">
              <Skeleton className="h-14 w-14 rounded-full" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      ) : onlineCount === 0 ? (
        <EmptyFriends hasAny={total > 0} />
      ) : (
        <ul
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]"
          aria-label={t('dashboard.friendsListAria')}
        >
          {online.map((friend, i) => (
            <OnlineFriendItem
              key={friend.friendshipId}
              friend={friend}
              status={presence[friend.profile.id] ?? 'online'}
              index={i}
            />
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}

function OnlineFriendItem({
  friend,
  status,
  index,
}: {
  friend: FriendSummary;
  status: OnlineStatus;
  index: number;
}) {
  const t = useTranslations('misc');
  const { profile } = friend;
  const canCall = status === 'online' || status === 'away';
  const statusKey = STATUS_LABEL_KEY[status] ?? 'dashboard.statusOnline';

  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
      className="group relative w-[4.75rem] shrink-0"
    >
      <Link
        href={`/profile/${profile.id}`}
        className="flex flex-col items-center gap-1.5 rounded-2xl p-1.5 transition-colors hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Avatar
          src={profile.avatarUrl ?? undefined}
          alt={profile.nickname}
          size="lg"
          status={status}
          ring={profile.isPremium ? 'aurora' : 'none'}
        />
        <span className="w-full truncate text-center text-xs font-medium">{profile.nickname}</span>
        <span className="text-[0.625rem] text-muted-foreground">{t(statusKey)}</span>
      </Link>

      {/* Hover quick-actions overlay. */}
      <div className="pointer-events-none absolute inset-x-1.5 top-1.5 flex justify-center gap-1.5 opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100">
        <Link
          href={`${ROUTES.chats}?to=${profile.id}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm ring-1 ring-border/70 backdrop-blur transition-colors hover:text-[var(--color-neon-cyan)]"
          aria-label={t('dashboard.friendMessageAria', { name: profile.nickname })}
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
        {canCall && (
          <Link
            href={`${ROUTES.video}?to=${profile.id}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm ring-1 ring-border/70 backdrop-blur transition-colors hover:text-[var(--color-neon-violet)]"
            aria-label={t('dashboard.friendVideoAria', { name: profile.nickname })}
          >
            <Video className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>
    </motion.li>
  );
}

function EmptyFriends({ hasAny }: { hasAny: boolean }) {
  const t = useTranslations('misc');
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/70 py-7 text-center">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-card/60 text-muted-foreground ring-1 ring-border/60">
        <Users className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="text-sm text-muted-foreground">
        {hasAny ? t('dashboard.friendsEmptyOnline') : t('dashboard.friendsEmptyNone')}
      </p>
      <Link
        href={ROUTES.friends}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-neon-cyan)] transition-colors hover:text-foreground"
      >
        <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
        {hasAny ? t('dashboard.friendsOpen') : t('dashboard.friendsFind')}
      </Link>
    </div>
  );
}
