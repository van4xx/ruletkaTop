'use client';

/**
 * "Send a gift" dialog used on a public profile. Reuses the economy/gifts
 * feature hooks ({@link useGifts}, {@link useSendGift}) so coin debiting and
 * wallet invalidation stay centralised. Sends with `context: 'profile'`.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Gift as GiftIcon, Coins, Lock } from 'lucide-react';
import type { Gift } from '@ruletka/shared-types';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
  Textarea,
  toast,
} from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { ApiClientError } from '@/lib/api';
import { useAuth } from '@/features/auth';
import { useGifts, useGiftsByRarity, useSendGift } from '@/features/gifts/use-gifts';
import { RARITY_STYLES } from '@/features/gifts/rarity';
import { ErrorState } from '@/components/social/state-views';

export function SendGiftDialog({
  open,
  onOpenChange,
  recipientId,
  recipientName,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientId: string;
  recipientName: string;
  onSent?: () => void;
}) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const tEconomy = useTranslations('economy');
  const { isPremium } = useAuth();
  const giftsQuery = useGifts();
  const grouped = useGiftsByRarity(giftsQuery.data);
  const sendGift = useSendGift();

  const [selected, setSelected] = useState<Gift | null>(null);
  const [message, setMessage] = useState('');

  function reset() {
    setSelected(null);
    setMessage('');
  }

  function handleSend() {
    if (!selected) return;
    sendGift.mutate(
      {
        giftId: selected.id,
        toUserId: recipientId,
        context: 'profile',
        message: message.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success(t('sendGift.sentTitle'), {
            description: t('sendGift.sentDescription', {
              title: selected.title,
              name: recipientName,
            }),
          });
          reset();
          onOpenChange(false);
          onSent?.();
        },
        onError: (err) => {
          const msg =
            err instanceof ApiClientError && err.status === 422
              ? t('sendGift.errorInsufficient')
              : err instanceof ApiClientError && err.status === 403
                ? t('sendGift.errorPremiumOnly')
                : t('sendGift.errorGeneric');
          toast.error(msg);
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('sendGift.title', { name: recipientName })}</DialogTitle>
          <DialogDescription>{t('sendGift.description')}</DialogDescription>
        </DialogHeader>

        {giftsQuery.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner size="lg" tone="accent" label={t('sendGift.loading')} />
          </div>
        ) : giftsQuery.isError ? (
          <ErrorState
            onRetry={() => void giftsQuery.refetch()}
            description={t('sendGift.catalogError')}
          />
        ) : (
          <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
            {grouped.map(({ rarity, gifts }) => {
              const style = RARITY_STYLES[rarity];
              return (
                <div key={rarity}>
                  <div className="mb-2 flex items-center gap-2">
                    <Badge variant={style.badge} size="sm">
                      {tEconomy(style.labelKey)}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {gifts.map((gift) => {
                      const locked = gift.isPremiumOnly && !isPremium;
                      const isSelected = selected?.id === gift.id;
                      return (
                        <button
                          key={gift.id}
                          type="button"
                          disabled={locked}
                          onClick={() => setSelected(gift)}
                          aria-pressed={isSelected}
                          className={cn(
                            'group relative flex aspect-square flex-col items-center justify-center gap-1 overflow-hidden rounded-xl bg-card/50 p-2 ring-1 transition-all',
                            isSelected
                              ? 'ring-2 ring-[var(--color-neon-violet)] ring-offset-2 ring-offset-background'
                              : 'ring-border/60 hover:-translate-y-0.5 hover:ring-border',
                            locked && 'cursor-not-allowed opacity-50',
                          )}
                        >
                          <div
                            aria-hidden="true"
                            className={cn(
                              'absolute inset-0 bg-gradient-to-br opacity-40',
                              style.glow,
                            )}
                          />
                          <GiftThumb gift={gift} />
                          <span className="relative truncate text-[0.625rem] font-medium">
                            {gift.title}
                          </span>
                          <span className="relative inline-flex items-center gap-0.5 text-[0.625rem] font-semibold text-[var(--color-neon-cyan)]">
                            {locked ? (
                              <Lock className="h-3 w-3" />
                            ) : (
                              <>
                                <Coins className="h-3 w-3" />
                                {gift.priceCoins}
                              </>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 200))}
                placeholder={t('sendGift.messagePlaceholder')}
                rows={2}
                aria-label={t('sendGift.messageAria')}
              />
              <p className="mt-1 text-right text-xs text-muted-foreground">{message.length}/200</p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            variant="primary"
            leadingIcon={<GiftIcon className="h-4 w-4" />}
            disabled={!selected}
            loading={sendGift.isPending}
            onClick={handleSend}
          >
            {selected
              ? t('sendGift.submitWithPrice', { price: selected.priceCoins })
              : t('sendGift.submitEmpty')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GiftThumb({ gift }: { gift: Gift }) {
  const [failed, setFailed] = useState(false);
  if (!gift.animationUrl || failed) {
    return <GiftIcon className="relative h-7 w-7 text-foreground/80" aria-hidden="true" />;
  }

  return (
    <img
      src={gift.animationUrl}
      alt=""
      className="relative h-8 w-8 object-contain"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
