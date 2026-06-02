'use client';

/**
 * Send-a-gift dialog. Confirms the chosen gift, collects a recipient id and an
 * optional message (validated against the shared `sendGiftSchema`), and submits
 * to POST /gifts/send. Surfaces the contract error cases:
 *   - 402/422 insufficient balance → prompt to top up
 *   - 403 premium-only gift sent by a non-premium member
 */
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Crown, Send } from 'lucide-react';
import Link from 'next/link';
import {
  sendGiftSchema,
  type Gift,
  type SendGiftDto,
  type GiftContext,
} from '@ruletka/shared-types';
import {
  Badge,
  Button,
  CoinIcon,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
  toast,
} from '@ruletka/ui';
import { ApiClientError } from '@/lib/api';
import { formatNumber } from '@/features/economy/format';
import { RARITY_STYLES } from '@/features/gifts/rarity';
import { useSendGift } from '@/features/gifts/use-gifts';
import { GiftMedia } from './gift-media';

export interface SendGiftDialogProps {
  gift: Gift | null;
  isPremium: boolean;
  /** Optional preset recipient (e.g. when launched from a profile). */
  presetRecipientId?: string;
  context?: GiftContext;
  onClose: () => void;
}

export function SendGiftDialog({
  gift,
  isPremium,
  presetRecipientId,
  context = 'profile',
  onClose,
}: SendGiftDialogProps) {
  const send = useSendGift();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<SendGiftDto>({
    resolver: zodResolver(sendGiftSchema),
    defaultValues: {
      giftId: gift?.id ?? '',
      toUserId: presetRecipientId ?? '',
      context,
      message: '',
    },
  });

  // Re-seed the form whenever the selected gift changes.
  useEffect(() => {
    if (gift) {
      reset({
        giftId: gift.id,
        toUserId: presetRecipientId ?? '',
        context,
        message: '',
      });
    }
  }, [gift, presetRecipientId, context, reset]);

  const locked = !!gift?.isPremiumOnly && !isPremium;

  const onSubmit = (values: SendGiftDto) => {
    send.mutate(values, {
      onSuccess: () => {
        toast.success('Подарок отправлен!', {
          description: gift ? `${gift.title} уже в пути.` : undefined,
        });
        onClose();
      },
      onError: (err) => {
        if (err instanceof ApiClientError) {
          if (err.status === 402 || err.status === 422) {
            setError('toUserId', { message: 'Недостаточно монет на балансе.' });
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
            setError('toUserId', { message: 'Получатель не найден.' });
            return;
          }
        }
        toast.error('Не удалось отправить подарок');
      },
    });
  };

  const style = gift ? RARITY_STYLES[gift.rarity] : null;

  return (
    <Dialog open={!!gift} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Отправить подарок</DialogTitle>
          <DialogDescription>
            Подарок спишется с вашего баланса монет и придёт получателю мгновенно.
          </DialogDescription>
        </DialogHeader>

        {gift && (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Gift preview */}
            <div className="flex items-center gap-4 rounded-2xl border border-border/60 bg-card/40 p-3">
              <div className="h-20 w-20 shrink-0">
                <GiftMedia url={gift.animationUrl} title={gift.title} rarity={gift.rarity} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate font-semibold text-foreground">{gift.title}</p>
                  {style && (
                    <Badge variant={style.badge} size="sm">
                      {style.label}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 inline-flex items-center gap-1.5">
                  <CoinIcon size="sm" className="text-[var(--coin)]" />
                  <span className="text-sm font-bold tabular-nums">{formatNumber(gift.priceCoins)}</span>
                </div>
              </div>
            </div>

            {locked ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-5 text-center">
                <Crown className="h-7 w-7 text-warning" aria-hidden="true" />
                <p className="text-sm text-foreground">
                  Этот подарок могут дарить только премиум-участники.
                </p>
                <Button asChild size="sm" variant="secondary">
                  <Link href="/premium">Подключить премиум</Link>
                </Button>
              </div>
            ) : (
              <>
                {/* Recipient */}
                <div className="space-y-1.5">
                  <Label htmlFor="toUserId" required>
                    ID получателя
                  </Label>
                  <Input
                    id="toUserId"
                    placeholder="Например, 663f1a2b9c0e4d5f6a7b8c9d"
                    invalid={!!errors.toUserId}
                    {...register('toUserId')}
                  />
                  {errors.toUserId && (
                    <p className="text-xs text-destructive">{errors.toUserId.message}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Откройте профиль собеседника и скопируйте его идентификатор.
                  </p>
                </div>

                {/* Message */}
                <div className="space-y-1.5">
                  <Label htmlFor="message">Сообщение (необязательно)</Label>
                  <Textarea
                    id="message"
                    rows={3}
                    maxLength={200}
                    placeholder="Добавьте тёплые слова…"
                    invalid={!!errors.message}
                    {...register('message')}
                  />
                  {errors.message && (
                    <p className="text-xs text-destructive">{errors.message.message}</p>
                  )}
                </div>
              </>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Отмена
              </Button>
              {!locked && (
                <Button
                  type="submit"
                  loading={send.isPending}
                  leadingIcon={<Send className="h-4 w-4" />}
                >
                  Подарить за {formatNumber(gift.priceCoins)}
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
