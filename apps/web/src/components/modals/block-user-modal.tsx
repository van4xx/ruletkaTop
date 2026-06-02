'use client';

/**
 * Block-user confirmation. POSTs to `/blocks` (via the friends feature's
 * `useBlockUser`). Blocking also severs any friendship server-side, so when a
 * `friendshipId` is supplied we drop it from the cached friends list too, and
 * fire the optional `onBlocked` callback (e.g. to leave an active call).
 */
import { useTranslations } from 'next-intl';
import { ShieldBan } from 'lucide-react';
import {
  Button,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from '@ruletka/ui';
import { useModal, useModalProps } from '@/lib/stores/modal-store';
import { useBlockUser, useRemoveFriendship } from '@/features/friends/use-friends';

export function BlockUserModal() {
  const { close } = useModal();
  const t = useTranslations('chrome');
  const { userId, nickname, friendshipId, onBlocked } = useModalProps<'block-user'>();
  const block = useBlockUser();
  const removeFriendship = useRemoveFriendship();

  const name = nickname?.trim() || t('modals.blockUser.fallbackName');

  function handleBlock() {
    block.mutate(userId, {
      onSuccess: () => {
        if (friendshipId) removeFriendship.mutate(friendshipId);
        toast.success(t('modals.blockUser.blockedTitle', { name }), {
          description: t('modals.blockUser.blockedDescription'),
        });
        onBlocked?.();
        close();
      },
      onError: () => toast.error(t('modals.blockUser.errGeneric')),
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('modals.blockUser.title')}</DialogTitle>
        <DialogDescription>
          <span className="font-medium text-foreground">{name}</span>{' '}
          {t('modals.blockUser.descriptionPrefix')}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close} disabled={block.isPending}>
          {t('modals.blockUser.cancel')}
        </Button>
        <Button
          type="button"
          variant="danger"
          loading={block.isPending}
          leadingIcon={<ShieldBan className="h-4 w-4" />}
          onClick={handleBlock}
        >
          {t('modals.blockUser.block')}
        </Button>
      </DialogFooter>
    </>
  );
}
