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
import { useTranslations } from 'next-intl';
import {
  Flag,
  Gift as GiftIcon,
  MessageCircle,
  MoreHorizontal,
  UserPlus,
  UserX,
  Video,
} from 'lucide-react';
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
  const t = useTranslations('profile');
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
      <Button
        asChild
        variant="secondary"
        size="sm"
        leadingIcon={<MessageCircle className="h-4 w-4" />}
      >
        <Link href={`${ROUTES.chats}?to=${profileId}`}>{t('actions.message')}</Link>
      </Button>

      {canCall && (
        <IconButton asChild variant="glass" size="sm" aria-label={t('actions.videoCall')}>
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
            () =>
              open('gift-picker', {
                toUserId: profileId,
                toNickname: nickname,
                context: 'profile',
              }),
            t('actions.authGift'),
          )
        }
      >
        {t('actions.sendGift')}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton variant="ghost" size="sm" aria-label={t('actions.more')}>
            <MoreHorizontal aria-hidden="true" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() =>
              requireAuth(
                () => open('add-friend', { presetUserId: profileId, nickname }),
                t('actions.authFriend'),
              )
            }
          >
            <UserPlus aria-hidden="true" />
            {t('actions.addFriend')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              requireAuth(
                () => open('report-user', { userId: profileId, nickname }),
                t('actions.authReport'),
              )
            }
          >
            <Flag aria-hidden="true" />
            {t('actions.report')}
          </DropdownMenuItem>
          <DropdownMenuItem
            destructive
            onSelect={() =>
              requireAuth(
                () => open('block-user', { userId: profileId, nickname, onBlocked }),
                t('actions.authBlock'),
              )
            }
          >
            <UserX aria-hidden="true" />
            {t('actions.block')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
