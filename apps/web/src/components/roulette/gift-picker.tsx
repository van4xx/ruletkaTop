'use client';

/**
 * Self-contained in-call gift picker. Fetches the catalogue (`GET /gifts`) and
 * sends a chosen gift to the peer (`POST /gifts/send`) with an optional note.
 * Has its own loading / empty / error states and does not depend on any other
 * feature's components.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Crown, Gift as GiftIcon, Sparkles } from 'lucide-react';
import {
  Badge,
  Button,
  CoinBalance,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
  Spinner,
  toast,
} from '@ruletka/ui';
import type { Gift, Rarity } from '@ruletka/shared-types';
import { useGifts, useSendGift } from '@/hooks/roulette/use-roulette-api';
import { cn } from '@/lib/cn';

export interface GiftPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Recipient (the current peer). */
  toUserId: string;
  /** Recipient display name for the header. */
  peerName: string;
  /** Whether the current user has premium (premium-only gifts unlock). */
  isPremium: boolean;
}

const rarityBadge: Record<Rarity, 'common' | 'rare' | 'epic' | 'legendary'> = {
  common: 'common',
  rare: 'rare',
  epic: 'epic',
  legendary: 'legendary',
};

const rarityLabelKey: Record<Rarity, string> = {
  common: 'gift.rarityCommon',
  rare: 'gift.rarityRare',
  epic: 'gift.rarityEpic',
  legendary: 'gift.rarityLegendary',
};

export function GiftPicker({ open, onOpenChange, toUserId, peerName, isPremium }: GiftPickerProps) {
  const t = useTranslations('roulette');
  const giftsQuery = useGifts(open);
  const sendGift = useSendGift();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const gifts = giftsQuery.data ?? [];
  const selected = gifts.find((g) => g.id === selectedId) ?? null;

  function handleSend() {
    if (!selected) return;
    sendGift.mutate(
      {
        giftId: selected.id,
        toUserId,
        context: 'call',
        message: message.trim() ? message.trim().slice(0, 200) : undefined,
      },
      {
        onSuccess: () => {
          toast.success(t('gift.sentTitle', { name: peerName }), {
            description: selected.title,
          });
          setSelectedId(null);
          setMessage('');
          onOpenChange(false);
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : t('gift.sendError');
          toast.error(msg);
        },
      },
    );
  }

  const locked = (g: Gift) => g.isPremiumOnly && !isPremium;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[var(--color-neon-magenta)]" />
            {t('gift.title', { name: peerName })}
          </DialogTitle>
          <DialogDescription>{t('gift.description')}</DialogDescription>
        </DialogHeader>

        {/* States */}
        {giftsQuery.isPending ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-2xl" />
            ))}
          </div>
        ) : giftsQuery.isError ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">{t('gift.loadError')}</p>
            <Button variant="outline" size="sm" onClick={() => giftsQuery.refetch()}>
              {t('gift.retry')}
            </Button>
          </div>
        ) : gifts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <GiftIcon className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('gift.empty')}</p>
          </div>
        ) : (
          <div
            role="listbox"
            aria-label={t('gift.listAriaLabel')}
            className="grid max-h-[46vh] grid-cols-3 gap-3 overflow-y-auto p-0.5 sm:grid-cols-4"
          >
            {gifts.map((gift) => {
              const isLocked = locked(gift);
              const isSelected = gift.id === selectedId;
              return (
                <motion.button
                  key={gift.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={isLocked}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => !isLocked && setSelectedId(gift.id)}
                  className={cn(
                    'group relative flex aspect-square flex-col items-center justify-center gap-1.5 rounded-2xl border p-2 text-center transition-all',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isSelected
                      ? 'border-[var(--color-neon-violet)] bg-[var(--color-neon-violet)]/10 shadow-glow'
                      : 'border-border bg-card/40 hover:border-border-strong hover:bg-card/70',
                    isLocked && 'cursor-not-allowed opacity-50',
                  )}
                >
                  {/* Animation thumbnail (image/lottie url). Fallback to icon. */}
                  <span className="grid h-10 w-10 place-items-center text-2xl">
                    {gift.animationUrl ? (
                      // Most gift assets are small images/gifs; an <img> is enough.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={gift.animationUrl}
                        alt=""
                        aria-hidden="true"
                        className="h-10 w-10 object-contain"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <GiftIcon className="h-6 w-6 text-[var(--color-neon-magenta)]" />
                    )}
                  </span>
                  <span className="line-clamp-1 text-xs font-medium">{gift.title}</span>
                  <CoinBalance amount={gift.priceCoins} size="sm" variant="pill" />
                  {gift.rarity !== 'common' && (
                    <Badge
                      variant={rarityBadge[gift.rarity]}
                      size="sm"
                      className="absolute left-1 top-1"
                    >
                      {t(rarityLabelKey[gift.rarity])}
                    </Badge>
                  )}
                  {isLocked && (
                    <Crown
                      className="absolute right-1 top-1 h-4 w-4 text-[var(--color-neon-magenta)]"
                      aria-label="Premium"
                    />
                  )}
                </motion.button>
              );
            })}
          </div>
        )}

        {/* Optional message */}
        {selected && (
          <div className="mt-1">
            <Input
              value={message}
              maxLength={200}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('gift.messagePlaceholder')}
              aria-label={t('gift.messageAriaLabel')}
            />
          </div>
        )}

        <DialogFooter className="sm:items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">
            {selected ? (
              <span className="inline-flex items-center gap-1.5">
                {t('gift.cost')}
                <CoinBalance amount={selected.priceCoins} size="sm" />
              </span>
            ) : (
              t('gift.selectPrompt')
            )}
          </span>
          <Button
            variant="primary"
            disabled={!selected || sendGift.isPending}
            onClick={handleSend}
            className="gap-2"
          >
            {sendGift.isPending ? (
              <Spinner size="sm" tone="current" />
            ) : (
              <GiftIcon className="h-4 w-4" />
            )}
            {t('gift.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
