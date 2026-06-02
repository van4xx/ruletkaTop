'use client';

/**
 * Pick + send an animated gift.
 *
 * - GET /gifts (via `useGifts`), grouped by rarity (legendary → common) with
 *   rarity-tinted cards and an animation preview (`GiftMedia`).
 * - Select a gift → confirm panel with the live balance and the cost.
 * - Send → POST /gifts/send (`useSendGift`) to the target user + context.
 * - Premium-only gifts are gated for non-premium senders (also enforced
 *   server-side); insufficient balance surfaces an inline "не хватает монет"
 *   banner that opens the buy-coins modal.
 *
 * If no recipient was supplied by the opener, a recipient-id field is shown
 * (validated against the shared `objectIdSchema`).
 */
import { useMemo, useState } from 'react';
import { ArrowLeft, Crown, Send } from 'lucide-react';
import {
  objectIdSchema,
  type Gift,
  type GiftContext,
  type SendGiftDto,
} from '@ruletka/shared-types';
import {
  Badge,
  Button,
  CoinIcon,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  Textarea,
  toast,
} from '@ruletka/ui';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useModal, useModalProps } from '@/lib/stores/modal-store';
import { formatNumber } from '@/features/economy/format';
import { RARITY_STYLES } from '@/features/gifts/rarity';
import { useGifts, useGiftsByRarity, useSendGift } from '@/features/gifts/use-gifts';
import { useIsPremium } from '@/features/economy/use-me';
import { useCoinBalance } from '@/hooks/wallet/use-wallet';
import { GiftMedia } from '@/components/gifts/gift-media';
import { BalancePill, FieldError, InsufficientCoins, ROUTES, FullPageLink } from './shared';

export function GiftPickerModal() {
  const { close } = useModal();
  const { toUserId, toNickname, context = 'profile' } = useModalProps<'gift-picker'>();

  const gifts = useGifts();
  const grouped = useGiftsByRarity(gifts.data);
  const isPremium = useIsPremium();
  const balance = useCoinBalance();
  const send = useSendGift();

  const [selected, setSelected] = useState<Gift | null>(null);
  const [recipient, setRecipient] = useState(toUserId ?? '');
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const locked = !!selected?.isPremiumOnly && !isPremium;
  const insufficient =
    selected != null && balance != null && balance < selected.priceCoins;

  const recipientFixed = Boolean(toUserId);

  function handleSend() {
    if (!selected) return;
    const id = recipient.trim();
    if (!objectIdSchema.safeParse(id).success) {
      setRecipientError('Введите корректный ID профиля (24 символа).');
      return;
    }
    const dto: SendGiftDto = {
      giftId: selected.id,
      toUserId: id,
      context: context as GiftContext,
      message: message.trim() || undefined,
    };
    send.mutate(dto, {
      onSuccess: () => {
        toast.success('Подарок отправлен!', { description: `${selected.title} уже в пути.` });
        close();
      },
      onError: (err) => {
        if (err instanceof ApiClientError) {
          if (err.status === 402 || err.status === 422) {
            toast.error('Недостаточно монет', {
              description: 'Пополните баланс, чтобы отправить подарок.',
            });
            return;
          }
          if (err.status === 403) {
            toast.error('Только для премиум', {
              description: 'Этот подарок доступен премиум-участникам.',
            });
            return;
          }
          if (err.status === 404) {
            setRecipientError('Получатель не найден.');
            return;
          }
        }
        toast.error('Не удалось отправить подарок');
      },
    });
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-center justify-between gap-2 pr-8">
          <DialogTitle>{selected ? 'Подтвердите подарок' : 'Выберите подарок'}</DialogTitle>
          <BalancePill balance={balance} />
        </div>
        <DialogDescription>
          {selected
            ? 'Подарок спишется с вашего баланса и придёт получателю мгновенно.'
            : toNickname
              ? `Подарок для ${toNickname}. Чем выше редкость — тем ярче впечатление.`
              : 'Анимированные подарки для звонков, чатов и профилей.'}
        </DialogDescription>
      </DialogHeader>

      {/* ── Step 1: catalogue ───────────────────────────────────────────── */}
      {!selected && (
        <div className="max-h-[55vh] space-y-5 overflow-y-auto pr-1">
          {gifts.isLoading && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-xl" />
              ))}
            </div>
          )}

          {gifts.isError && (
            <div className="rounded-xl border border-border/60 bg-card/40 p-6 text-center text-sm text-muted-foreground">
              Не удалось загрузить подарки.{' '}
              <button
                type="button"
                onClick={() => gifts.refetch()}
                className="font-medium text-accent hover:underline"
              >
                Повторить
              </button>
            </div>
          )}

          {!gifts.isLoading && !gifts.isError && grouped.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Каталог подарков пока пуст.
            </p>
          )}

          {grouped.map(({ rarity, gifts: list }) => {
            const style = RARITY_STYLES[rarity];
            return (
              <section key={rarity}>
                <div className="mb-2 flex items-center gap-2">
                  <Badge variant={style.badge} size="sm">
                    {style.label}
                  </Badge>
                  <span className="h-px flex-1 bg-border/60" aria-hidden="true" />
                </div>
                <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {list.map((gift) => {
                    const giftLocked = gift.isPremiumOnly && !isPremium;
                    return (
                      <li key={gift.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(gift);
                            setRecipientError(null);
                          }}
                          aria-label={`${gift.title} — ${formatNumber(gift.priceCoins)} монет`}
                          className={cn(
                            'group relative flex w-full flex-col items-center gap-1 rounded-xl border border-border/60 bg-card/40 p-2 transition-colors',
                            'hover:border-accent-muted hover:bg-card/70',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          )}
                        >
                          {giftLocked && (
                            <span
                              className="absolute right-1.5 top-1.5 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full bg-warning/90 text-[var(--color-background)]"
                              title="Только для премиум"
                            >
                              <Crown className="h-3 w-3" aria-hidden="true" />
                            </span>
                          )}
                          <div className="w-full">
                            <GiftMedia url={gift.animationUrl} title={gift.title} rarity={gift.rarity} />
                          </div>
                          <span className="line-clamp-1 text-center text-xs font-medium text-foreground">
                            {gift.title}
                          </span>
                          <span className="inline-flex items-center gap-1 text-xs font-bold tabular-nums text-[var(--coin)]">
                            <CoinIcon size="xs" />
                            {formatNumber(gift.priceCoins)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {/* ── Step 2: confirm + send ──────────────────────────────────────── */}
      {selected && (
        <div className="space-y-5">
          <div className="flex items-center gap-4 rounded-2xl border border-border/60 bg-card/40 p-3">
            <div className="h-20 w-20 shrink-0">
              <GiftMedia url={selected.animationUrl} title={selected.title} rarity={selected.rarity} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-semibold text-foreground">{selected.title}</p>
                <Badge variant={RARITY_STYLES[selected.rarity].badge} size="sm">
                  {RARITY_STYLES[selected.rarity].label}
                </Badge>
              </div>
              <div className="mt-1 inline-flex items-center gap-1.5">
                <CoinIcon size="sm" className="text-[var(--coin)]" />
                <span className="text-sm font-bold tabular-nums">
                  {formatNumber(selected.priceCoins)}
                </span>
              </div>
            </div>
          </div>

          {locked ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-5 text-center">
              <Crown className="h-7 w-7 text-warning" aria-hidden="true" />
              <p className="text-sm text-foreground">
                Этот подарок могут дарить только премиум-участники.
              </p>
              <FullPageLink href={ROUTES.me}>Открыть профиль</FullPageLink>
            </div>
          ) : (
            <>
              {insufficient && (
                <InsufficientCoins balance={balance} needed={selected.priceCoins} />
              )}

              {/* Recipient */}
              {!recipientFixed && (
                <div className="space-y-1.5">
                  <Label htmlFor="gift-recipient" required>
                    ID получателя
                  </Label>
                  <Input
                    id="gift-recipient"
                    value={recipient}
                    onChange={(e) => {
                      setRecipient(e.target.value);
                      if (recipientError) setRecipientError(null);
                    }}
                    placeholder="например, 663f1a2b9c0e4d5f6a7b8c9d"
                    invalid={!!recipientError}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <FieldError>{recipientError}</FieldError>
                </div>
              )}
              {recipientFixed && (
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">
                    Получатель:{' '}
                    <span className="font-medium text-foreground">{toNickname ?? 'выбран'}</span>
                  </p>
                  <FieldError>{recipientError}</FieldError>
                </div>
              )}

              {/* Message */}
              <div className="space-y-1.5">
                <Label htmlFor="gift-message">Сообщение (необязательно)</Label>
                <Textarea
                  id="gift-message"
                  rows={2}
                  maxLength={200}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Добавьте тёплые слова…"
                />
              </div>
            </>
          )}
        </div>
      )}

      <DialogFooter className={cn(selected && 'sm:justify-between')}>
        {selected ? (
          <Button
            type="button"
            variant="ghost"
            leadingIcon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => setSelected(null)}
          >
            К каталогу
          </Button>
        ) : (
          <Button type="button" variant="ghost" onClick={close}>
            Закрыть
          </Button>
        )}

        {selected && !locked && (
          <Button
            type="button"
            variant="primary"
            disabled={insufficient}
            loading={send.isPending}
            leadingIcon={<Send className="h-4 w-4" />}
            onClick={handleSend}
          >
            Подарить за {formatNumber(selected.priceCoins)}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
