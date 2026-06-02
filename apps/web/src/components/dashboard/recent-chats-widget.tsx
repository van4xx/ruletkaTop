'use client';

/**
 * Recent-conversations preview: the most-recently-active threads with the peer
 * avatar, last-message snippet, relative time, and an unread pill. Each row
 * deep-links into the thread. Driven by `useRecentChats` + `usePeerProfiles`
 * (peer resolution) and kept live by `useConversationRealtime`.
 */
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { MessageCircle, MessagesSquare } from 'lucide-react';
import type { Conversation } from '@ruletka/shared-types';
import { Avatar, Skeleton } from '@ruletka/ui';
import { ROUTES } from '@/config/nav';
import { cn } from '@/lib/cn';
import { useAuth } from '@/features/auth';
import {
  peerIdOf,
  usePeerProfiles,
  useConversationRealtime,
} from '@/features/chat/use-conversations';
import { formatRelativeTime } from '@/features/chat/lib/format';
import { useRecentChats } from '@/hooks/dashboard/use-dashboard';
import { ErrorState } from '@/components/economy/states';
import { DashboardCard, WidgetHeader } from './dashboard-card';

export function RecentChatsWidget() {
  const t = useTranslations('misc');
  const { user } = useAuth();
  const { conversations, unreadTotal, isLoading, isError, refetch } = useRecentChats(4);

  // Keep the cached inbox live while the dashboard is open.
  useConversationRealtime(null);

  const peerIds = conversations.map((c) => peerIdOf(c, user?.id ?? null)).filter(Boolean) as string[];
  const { byId } = usePeerProfiles(peerIds);

  return (
    <DashboardCard label={t('dashboard.chatsLabel')}>
      <WidgetHeader
        icon={<MessagesSquare className="h-4 w-4" aria-hidden="true" />}
        accent="var(--color-neon-violet)"
        title={t('dashboard.chatsTitle')}
        count={unreadTotal > 0 ? unreadTotal : null}
        href={ROUTES.chats}
      />

      {isError ? (
        <ErrorState
          title={t('dashboard.chatsErrorTitle')}
          description={t('dashboard.chatsErrorDesc')}
          onRetry={refetch}
        />
      ) : isLoading ? (
        <ul className="space-y-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 rounded-2xl p-2">
              <Skeleton className="h-11 w-11 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-40" />
              </div>
            </li>
          ))}
        </ul>
      ) : conversations.length === 0 ? (
        <EmptyChats />
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {conversations.map((c, i) => {
            const peerId = peerIdOf(c, user?.id ?? null);
            const peer = peerId ? byId.get(peerId) : undefined;
            return <ChatRow key={c.id} conversation={c} peerName={peer?.nickname} peerAvatar={peer?.avatarUrl} peerPremium={peer?.isPremium} index={i} />;
          })}
        </ul>
      )}
    </DashboardCard>
  );
}

function ChatRow({
  conversation,
  peerName,
  peerAvatar,
  peerPremium,
  index,
}: {
  conversation: Conversation;
  peerName?: string;
  peerAvatar?: string | null;
  peerPremium?: boolean;
  index: number;
}) {
  const t = useTranslations('misc');
  const hasUnread = conversation.unreadCount > 0;
  const name = peerName ?? t('dashboard.chatPeerFallback');
  const preview = conversation.lastMessagePreview ?? t('dashboard.chatNoMessages');

  return (
    <motion.li
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
    >
      <Link
        href={`${ROUTES.chats}/${conversation.id}`}
        className="flex items-center gap-3 rounded-2xl p-2 transition-colors hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {peerName === undefined ? (
          <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
        ) : (
          <Avatar src={peerAvatar ?? undefined} alt={name} size="lg" ring={peerPremium ? 'aurora' : 'none'} className="shrink-0" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={cn('truncate text-sm font-semibold', hasUnread && 'text-foreground')}>
              {name}
            </span>
            {conversation.lastMessageAt && (
              <span className="shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums">
                {formatRelativeTime(conversation.lastMessageAt)}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className={cn('truncate text-xs', hasUnread ? 'text-foreground/80' : 'text-muted-foreground')}>
              {preview}
            </p>
            {hasUnread && (
              <span className="inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-[var(--color-neon-magenta)] px-1 text-[0.625rem] font-bold tabular-nums text-white">
                {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
              </span>
            )}
          </div>
        </div>
      </Link>
    </motion.li>
  );
}

function EmptyChats() {
  const t = useTranslations('misc');
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/70 py-7 text-center">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-card/60 text-muted-foreground ring-1 ring-border/60">
        <MessageCircle className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="text-sm text-muted-foreground">{t('dashboard.chatsEmpty')}</p>
      <Link
        href={ROUTES.friends}
        className="text-xs font-semibold text-[var(--color-neon-violet)] transition-colors hover:text-foreground"
      >
        {t('dashboard.chatsStart')}
      </Link>
    </div>
  );
}
