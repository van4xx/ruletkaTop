'use client';

/**
 * A single friend row: avatar with live presence dot, nickname + badges, a
 * human-readable status line, and quick actions (message, video call, more).
 * The "more" menu holds destructive actions (remove / block) and a profile
 * link. Presence comes from the parent via the `status` prop (kept live by
 * `usePresence`).
 */
import Link from 'next/link';
import { motion } from 'framer-motion';
import { MessageCircle, MoreVertical, Phone, UserMinus, UserX, Video } from 'lucide-react';
import type { FriendSummary, OnlineStatus } from '@ruletka/shared-types';
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@ruletka/ui';
import { ROUTES } from '@/config/nav';
import { cn } from '@/lib/cn';
import { ProfileBadges } from '@/components/social/profile-badges';

const STATUS_LABEL: Record<OnlineStatus, string> = {
  online: 'В сети',
  offline: 'Не в сети',
  in_call: 'В звонке',
  away: 'Отошёл',
};

const STATUS_TONE: Record<OnlineStatus, string> = {
  online: 'text-success',
  offline: 'text-muted-foreground',
  in_call: 'text-[var(--color-neon-magenta)]',
  away: 'text-warning',
};

export interface FriendCardProps {
  friend: FriendSummary;
  status: OnlineStatus;
  onRemove: (friendshipId: string) => void;
  onBlock: (userId: string) => void;
  busy?: boolean;
}

export function FriendCard({ friend, status, onRemove, onBlock, busy }: FriendCardProps) {
  const { profile } = friend;
  const profileHref = `/profile/${profile.id}`;
  // Direct-call / direct-message deep links consumed by the roulette + chat
  // routes via a `?to=<userId>` query param.
  const callHref = `${ROUTES.video}?to=${profile.id}`;
  const chatHref = `${ROUTES.chats}?to=${profile.id}`;
  const canCall = status === 'online' || status === 'away';

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'glass-panel group flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-card/70 sm:gap-4 sm:p-4',
        busy && 'pointer-events-none opacity-60',
      )}
    >
      <Link href={profileHref} className="relative shrink-0 rounded-full" aria-label={`Профиль ${profile.nickname}`}>
        <Avatar
          src={profile.avatarUrl}
          alt={profile.nickname}
          size="lg"
          status={status}
          ring={profile.isPremium ? 'aurora' : 'none'}
        />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            href={profileHref}
            className="truncate font-display text-base font-semibold tracking-tight transition-colors hover:text-[var(--color-neon-cyan)]"
          >
            {profile.nickname}
          </Link>
          <ProfileBadges badges={profile.badges} size="sm" iconOnly />
        </div>
        <p className={cn('mt-0.5 text-sm font-medium', STATUS_TONE[status])}>{STATUS_LABEL[status]}</p>
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="glass" size="sm" className="px-3" aria-label="Написать сообщение">
              <Link href={chatHref}>
                <MessageCircle aria-hidden="true" />
                <span className="hidden sm:inline">Чат</span>
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Написать сообщение</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            {canCall ? (
              <IconButton asChild variant="glass" size="sm" aria-label="Видеозвонок">
                <Link href={callHref}>
                  <Video aria-hidden="true" />
                </Link>
              </IconButton>
            ) : (
              <IconButton variant="glass" size="sm" aria-label="Сейчас недоступен для звонка" disabled>
                {status === 'in_call' ? <Phone aria-hidden="true" /> : <Video aria-hidden="true" />}
              </IconButton>
            )}
          </TooltipTrigger>
          <TooltipContent>{canCall ? 'Позвонить' : 'Сейчас недоступен'}</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton variant="ghost" size="sm" aria-label="Ещё действия">
              <MoreVertical aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={profileHref}>Открыть профиль</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => onRemove(friend.friendshipId)}>
              <UserMinus aria-hidden="true" />
              Удалить из друзей
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={() => onBlock(profile.id)}>
              <UserX aria-hidden="true" />
              Заблокировать
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.li>
  );
}
