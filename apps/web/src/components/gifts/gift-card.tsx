'use client';

/**
 * A single gift in the catalogue — rarity-tinted glass card with the animation,
 * price in coins, a premium-only lock, and a hover-revealed "Send" action.
 */
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { Crown, Send } from 'lucide-react';
import type { Gift } from '@ruletka/shared-types';
import { Badge, Button, CoinIcon, Tooltip, TooltipContent, TooltipTrigger } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/features/economy/format';
import { RARITY_STYLES } from '@/features/gifts/rarity';
import { GiftMedia } from './gift-media';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export interface GiftCardProps {
  gift: Gift;
  /** Whether the viewer is a premium member (gates premium-only gifts). */
  isPremium: boolean;
  onSend: (gift: Gift) => void;
  index?: number;
}

export function GiftCard({ gift, isPremium, onSend, index = 0 }: GiftCardProps) {
  const t = useTranslations('economy');
  const style = RARITY_STYLES[gift.rarity];
  const locked = gift.isPremiumOnly && !isPremium;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE_OUT, delay: (index % 8) * 0.04 }}
      className="group relative flex flex-col"
    >
      <div
        className={cn(
          'glass-panel relative flex flex-col overflow-hidden rounded-2xl p-3',
          'transition-[transform,box-shadow] duration-300 hover:-translate-y-1',
        )}
        style={{
          boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${style.color} 28%, transparent)`,
        }}
      >
        <div className="relative">
          <GiftMedia url={gift.animationUrl} title={gift.title} rarity={gift.rarity} />
          <span className="absolute left-2 top-2">
            <Badge variant={style.badge} size="sm">
              {t(style.labelKey)}
            </Badge>
          </span>
          {gift.isPremiumOnly && (
            <span className="absolute right-2 top-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      'inline-flex h-6 w-6 items-center justify-center rounded-full',
                      'bg-[color-mix(in_oklch,var(--warning)_22%,transparent)] text-warning',
                    )}
                  >
                    <Crown className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">{t('giftCard.premiumOnly')}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('giftCard.premiumOnly')}</TooltipContent>
              </Tooltip>
            </span>
          )}
        </div>

        <div className="mt-3 px-1">
          <p className="truncate text-sm font-semibold text-foreground">{gift.title}</p>
          <div className="mt-1 inline-flex items-center gap-1.5">
            <CoinIcon size="sm" className="text-[var(--coin)]" />
            <span className="text-sm font-bold tabular-nums text-foreground">
              {formatNumber(gift.priceCoins)}
            </span>
          </div>
        </div>

        <Button
          size="sm"
          variant={locked ? 'outline' : 'secondary'}
          className="mt-3"
          block
          disabled={locked}
          leadingIcon={locked ? <Crown className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          onClick={() => onSend(gift)}
        >
          {locked ? t('giftCard.premiumLabel') : t('giftCard.send')}
        </Button>
      </div>
    </motion.div>
  );
}
