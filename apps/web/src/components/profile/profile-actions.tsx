'use client';

/**
 * The action bar shown on OTHERS' profiles. Every action funnels through the
 * unified modal store ({@link useModal}) where a modal exists, so behaviour
 * stays consistent app-wide:
 *   • Написать          → /chats?to=:id
 *   • Видеозвонок        → /video?to=:id   (only when reachable)
 *   • Подарить          → gift-picker modal (toUserId, context: 'profile')
 *   • Добавить в друзья  → add-friend modal (presetUserId)
 *   • Пожаловаться       → report-user modal
 *   • Заблокировать      → block-user modal (with onBlocked callback)
 *
 * Auth-gated actions prompt a sign-in toast when the viewer is anonymous.
 */
import Link from 'next/link';
import { Flag, Gift as GiftIcon, MessageCircle, MoreHorizontal, UserPlus, UserX, Video } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  toast,
} from '@ruletka/ui';
import type { OnlineStatus } from '@ruletka/shared-types';
import { ROUTES } from '@/config/nav';
import { useModal } from '@/lib/stores/modal-store';

export function ProfileActions({
  profileId,
  nickname,
  status,
  isAuthenticated,
  onBlocked,
}: {
  profileId: string;
  nickname: string;
  status?: OnlineStatus;
  isAuthenticated: boolean;
  onBlocked?: () => void;
}) {
  const { open } = useModal();
  const canCall = status === 'online' || status === 'away';

  function requireAuth(action: () => void, hint: string): void {
    if (!isAuthenticated) {
      toast.info(hint);
      return;
    }
    action();
  }

  return (
    <>
      <Button asChild variant="secondary" size="sm" leadingIcon={<MessageCircle className="h-4 w-4" />}>
        <Link href={`${ROUTES.chats}?to=${profileId}`}>Написать</Link>
      </Button>

      {canCall && (
        <IconButton asChild variant="glass" size="sm" aria-label="Видеозвонок">
          <Link href={`${ROUTES.video}?to=${profileId}`}>
            <Video aria-hidden="true" />
          </Link>
        </IconButton>
      )}

      <Button
        variant="primary"
        size="sm"
        leadingIcon={<GiftIcon className="h-4 w-4" />}
        onClick={() =>
          requireAuth(
            () => open('gift-picker', { toUserId: profileId, toNickname: nickname, context: 'profile' }),
            'Войдите, чтобы дарить подарки',
          )
        }
      >
        Подарить
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton variant="ghost" size="sm" aria-label="Ещё действия">
            <MoreHorizontal aria-hidden="true" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() =>
              requireAuth(
                () => open('add-friend', { presetUserId: profileId, nickname }),
                'Войдите, чтобы добавлять друзей',
              )
            }
          >
            <UserPlus aria-hidden="true" />
            Добавить в друзья
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              requireAuth(() => open('report-user', { userId: profileId, nickname }), 'Войдите, чтобы пожаловаться')
            }
          >
            <Flag aria-hidden="true" />
            Пожаловаться
          </DropdownMenuItem>
          <DropdownMenuItem
            destructive
            onSelect={() =>
              requireAuth(
                () => open('block-user', { userId: profileId, nickname, onBlocked }),
                'Войдите, чтобы заблокировать',
              )
            }
          >
            <UserX aria-hidden="true" />
            Заблокировать
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
