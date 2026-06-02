'use client';

/**
 * "Add a friend" dialog. The API takes a recipient user id
 * (`POST /friends/request { recipientId }`) and there is no user-search
 * endpoint yet, so the primary input is a profile id (the same id used in
 * `/profile/:id` links). Validated client-side against the shared
 * `objectIdSchema` before the mutation fires.
 */
import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { objectIdSchema } from '@ruletka/shared-types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  toast,
} from '@ruletka/ui';
import { ApiClientError } from '@/lib/api';
import { useSendFriendRequest } from '@/features/friends/use-friends';

export function AddFriendDialog({ trigger }: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sendRequest = useSendFriendRequest();

  function reset() {
    setValue('');
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    const parsed = objectIdSchema.safeParse(trimmed);
    if (!parsed.success) {
      setError('Введите корректный ID профиля (24 символа).');
      return;
    }
    setError(null);
    sendRequest.mutate(trimmed, {
      onSuccess: () => {
        toast.success('Заявка отправлена', { description: 'Дождитесь, пока пользователь её примет.' });
        reset();
        setOpen(false);
      },
      onError: (err) => {
        const message =
          err instanceof ApiClientError && err.status === 409
            ? 'Заявка уже существует или вы уже друзья.'
            : err instanceof ApiClientError && err.status === 400
              ? 'Нельзя отправить заявку этому пользователю.'
              : 'Не удалось отправить заявку. Попробуйте позже.';
        setError(message);
      },
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="primary" size="sm" leadingIcon={<UserPlus className="h-4 w-4" />}>
            Добавить друга
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Добавить друга</DialogTitle>
          <DialogDescription>
            Отправьте заявку по ID профиля. ID можно скопировать на странице профиля пользователя.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-2">
          <Label htmlFor="friend-id">ID профиля</Label>
          <Input
            id="friend-id"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            placeholder="например, 65f1a2b3c4d5e6f7a8b9c0d1"
            invalid={Boolean(error)}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={error ? 'friend-id-error' : undefined}
          />
          {error && (
            <p id="friend-id-error" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" variant="primary" loading={sendRequest.isPending}>
              Отправить заявку
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
