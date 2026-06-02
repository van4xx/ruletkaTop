'use client';

/**
 * Send a friend request. Two modes:
 *   - preset: launched from a profile/peer card → shows the target's name and a
 *     one-tap "send request" (id already known).
 *   - manual: no preset → an ID field validated against the shared
 *     `objectIdSchema` (the same 24-char id used in `/profile/:id` links), since
 *     the API takes a recipient id and there is no user-search endpoint yet.
 *
 * Submits `POST /friends/request { recipientId }` via the friends feature hook.
 */
import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { objectIdSchema } from '@ruletka/shared-types';
import {
  Button,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  toast,
} from '@ruletka/ui';
import { ApiClientError } from '@/lib/api';
import { useModal, useModalProps } from '@/lib/stores/modal-store';
import { useSendFriendRequest } from '@/features/friends/use-friends';
import { FieldError } from './shared';

export function AddFriendModal() {
  const { close, open } = useModal();
  const { presetUserId, nickname } = useModalProps<'add-friend'>();
  const sendRequest = useSendFriendRequest();

  const [value, setValue] = useState(presetUserId ?? '');
  const [error, setError] = useState<string | null>(null);
  const hasPreset = Boolean(presetUserId);

  function submit(recipientId: string) {
    sendRequest.mutate(recipientId, {
      onSuccess: () => {
        toast.success('Заявка отправлена', {
          description: nickname
            ? `Дождитесь, пока ${nickname} её примет.`
            : 'Дождитесь, пока пользователь её примет.',
        });
        close();
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    const parsed = objectIdSchema.safeParse(trimmed);
    if (!parsed.success) {
      setError('Введите корректный ID профиля (24 символа).');
      return;
    }
    setError(null);
    submit(trimmed);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Добавить друга</DialogTitle>
        <DialogDescription>
          {hasPreset
            ? 'Отправить заявку в друзья этому пользователю?'
            : 'Отправьте заявку по ID профиля. ID можно скопировать на странице профиля.'}
        </DialogDescription>
      </DialogHeader>

      {hasPreset ? (
        <>
          <div className="rounded-xl border border-border/60 bg-card/40 p-4 text-center">
            <p className="font-display text-lg font-bold text-foreground">
              {nickname?.trim() || 'Пользователь'}
            </p>
            <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
              {presetUserId}
            </p>
          </div>
          <FieldError>{error}</FieldError>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              Отмена
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={sendRequest.isPending}
              leadingIcon={<UserPlus className="h-4 w-4" />}
              onClick={() => submit(presetUserId!)}
            >
              Отправить заявку
            </Button>
          </DialogFooter>
        </>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-2">
          <Label htmlFor="add-friend-id">ID профиля</Label>
          <Input
            id="add-friend-id"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            placeholder="например, 65f1a2b3c4d5e6f7a8b9c0d1"
            invalid={Boolean(error)}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={error ? 'add-friend-id-error' : undefined}
          />
          <FieldError id="add-friend-id-error">{error}</FieldError>

          <DialogFooter>
            <Button type="button" variant="link" className="mr-auto" onClick={() => open('search-users')}>
              Найти по нику
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              Отмена
            </Button>
            <Button type="submit" variant="primary" loading={sendRequest.isPending}>
              Отправить заявку
            </Button>
          </DialogFooter>
        </form>
      )}
    </>
  );
}
