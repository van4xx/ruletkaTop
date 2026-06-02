'use client';

/** Confirmation dialog for blocking the current peer (`POST /blocks`). */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
  toast,
} from '@ruletka/ui';
import { UserX } from 'lucide-react';
import { useBlockUser } from '@/hooks/roulette/use-roulette-api';

export interface BlockConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blockedUserId: string;
  peerName: string;
  /** Called after a successful block (parent typically skips to next). */
  onBlocked?: () => void;
}

export function BlockConfirmDialog({
  open,
  onOpenChange,
  blockedUserId,
  peerName,
  onBlocked,
}: BlockConfirmDialogProps) {
  const block = useBlockUser();

  function confirm() {
    block.mutate(
      { blockedUserId },
      {
        onSuccess: () => {
          toast.success(`${peerName} заблокирован`, {
            description: 'Вы больше не будете попадать друг на друга.',
          });
          onOpenChange(false);
          onBlocked?.();
        },
        onError: (err: unknown) => {
          toast.error(err instanceof Error ? err.message : 'Не удалось заблокировать');
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserX className="h-5 w-5 text-destructive" />
            Заблокировать {peerName}?
          </DialogTitle>
          <DialogDescription>
            Вы больше не встретите этого пользователя в рулетке. Действие можно отменить в
            настройках.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button variant="danger" onClick={confirm} disabled={block.isPending} className="gap-2">
            {block.isPending ? <Spinner size="sm" tone="current" /> : <UserX className="h-4 w-4" />}
            Заблокировать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
