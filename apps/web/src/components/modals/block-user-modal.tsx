'use client';

/**
 * Block-user confirmation. POSTs to `/blocks` (via the friends feature's
 * `useBlockUser`). Blocking also severs any friendship server-side, so when a
 * `friendshipId` is supplied we drop it from the cached friends list too, and
 * fire the optional `onBlocked` callback (e.g. to leave an active call).
 */
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
  const { userId, nickname, friendshipId, onBlocked } = useModalProps<'block-user'>();
  const block = useBlockUser();
  const removeFriendship = useRemoveFriendship();

  const name = nickname?.trim() || 'Этот пользователь';

  function handleBlock() {
    block.mutate(userId, {
      onSuccess: () => {
        if (friendshipId) removeFriendship.mutate(friendshipId);
        toast.success(`${name} заблокирован`, {
          description: 'Он больше не сможет писать вам и звонить.',
        });
        onBlocked?.();
        close();
      },
      onError: () => toast.error('Не удалось заблокировать пользователя'),
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Заблокировать пользователя?</DialogTitle>
        <DialogDescription>
          <span className="font-medium text-foreground">{name}</span> больше не сможет писать вам,
          звонить или находить вас в рулетке. Если вы друзья — дружба будет разорвана.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close} disabled={block.isPending}>
          Отмена
        </Button>
        <Button
          type="button"
          variant="danger"
          loading={block.isPending}
          leadingIcon={<ShieldBan className="h-4 w-4" />}
          onClick={handleBlock}
        >
          Заблокировать
        </Button>
      </DialogFooter>
    </>
  );
}
