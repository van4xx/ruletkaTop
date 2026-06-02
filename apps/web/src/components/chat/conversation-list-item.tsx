'use client';

/**
 * A single conversation row in the inbox: peer avatar with live presence,
 * nickname, last-message preview, relative time and an unread badge. The whole
 * row links into the thread.
 */
import Link from 'next/link';
import type { Conversation, OnlineStatus, PublicProfile } from '@ruletka/shared-types';
import { Avatar, Skeleton } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/features/chat/lib/format';

export function ConversationListItem({
  conversation,
  peer,
  status,
  active,
}: {
  conversation: Conversation;
  peer?: PublicProfile;
  status: OnlineStatus;
  active?: boolean;
}) {
  const unread = conversation.unreadCount > 0;

  return (
    <Link
      href={`/chats/${conversation.id}`}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'group flex items-center gap-3 rounded-2xl p-3 transition-colors',
        active ? 'bg-card/80 ring-1 ring-[var(--color-neon-violet)]/30' : 'hover:bg-card/60',
      )}
    >
      {peer ? (
        <Avatar
          src={peer.avatarUrl}
          alt={peer.nickname}
          size="lg"
          status={status}
          ring={peer.isPremium ? 'aurora' : 'none'}
          className="shrink-0"
        />
      ) : (
        <Skeleton shape="circle" className="h-14 w-14 shrink-0" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-display text-[0.95rem] font-semibold tracking-tight">
            {peer?.nickname ?? 'Собеседник'}
          </span>
          {conversation.lastMessageAt && (
            <time
              dateTime={conversation.lastMessageAt}
              className={cn(
                'shrink-0 text-xs',
                unread ? 'font-semibold text-[var(--color-neon-cyan)]' : 'text-muted-foreground',
              )}
            >
              {formatRelativeTime(conversation.lastMessageAt)}
            </time>
          )}
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p
            className={cn(
              'truncate text-sm',
              unread ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {conversation.lastMessagePreview ?? 'Нет сообщений'}
          </p>
          {unread && (
            <span
              className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-neon-violet)] to-[var(--color-neon-magenta)] px-1.5 text-xs font-bold text-white shadow-[0_2px_10px_-2px_var(--color-neon-violet)]"
              aria-label={`${conversation.unreadCount} непрочитанных`}
            >
              {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
