'use client';

/**
 * /gifts — the gift catalogue.
 *
 * - GET /gifts, grouped + sorted by rarity (legendary → common)
 * - Rarity-tinted cards with animated media
 * - Send flow → POST /gifts/send, premium-only gifts gated by `isPremium`
 *   (from GET /profile/me) both in the UI and enforced server-side.
 */
import { useState } from 'react';
import Link from 'next/link';
import { Crown, Gift as GiftIcon, Sparkles } from 'lucide-react';
import type { Gift } from '@ruletka/shared-types';
import { Badge, Button, CoinBalance, TooltipProvider } from '@ruletka/ui';
import { EconomyShell } from '@/components/economy/economy-shell';
import { CardGridSkeleton, EmptyState, ErrorState } from '@/components/economy/states';
import { GiftCard } from '@/components/gifts/gift-card';
import { SendGiftDialog } from '@/components/gifts/send-gift-dialog';
import { RARITY_STYLES } from '@/features/gifts/rarity';
import { useGifts, useGiftsByRarity } from '@/features/gifts/use-gifts';
import { useIsPremium } from '@/features/economy/use-me';
import { useCoinBalance } from '@/hooks/wallet/use-wallet';

export default function GiftsPage() {
  const gifts = useGifts();
  const grouped = useGiftsByRarity(gifts.data);
  const isPremium = useIsPremium();
  const balance = useCoinBalance();
  const [selected, setSelected] = useState<Gift | null>(null);

  return (
    <TooltipProvider delayDuration={200}>
      <EconomyShell
        eyebrow={
          <>
            <Sparkles className="h-3.5 w-3.5 text-[var(--color-neon-magenta)]" aria-hidden="true" />
            Магазин подарков
          </>
        }
        title={
          <>
            Дарите <span className="text-gradient-neon">эмоции</span>
          </>
        }
        lede="Анимированные подарки для звонков, чатов и профилей. Чем выше редкость — тем ярче впечатление."
        actions={
          <div className="flex items-center gap-3">
            <CoinBalance amount={balance ?? 0} variant="pill" />
            <Button asChild variant="outline" size="sm">
              <Link href="/coins">Пополнить</Link>
            </Button>
          </div>
        }
      >
        {/* Premium upsell banner for non-premium viewers. */}
        {!isPremium && (
          <div className="mb-8 flex flex-col items-start gap-3 rounded-2xl border border-warning/25 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-warning/20 text-warning">
                <Crown className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
              </span>
              <p className="text-sm text-foreground">
                Некоторые подарки доступны только премиум-участникам.
              </p>
            </div>
            <Button asChild size="sm" variant="secondary">
              <Link href="/premium">Подробнее о премиуме</Link>
            </Button>
          </div>
        )}

        {gifts.isLoading ? (
          <CardGridSkeleton count={8} className="lg:grid-cols-4" />
        ) : gifts.isError ? (
          <ErrorState
            title="Не удалось загрузить подарки"
            description="Каталог подарков временно недоступен."
            onRetry={() => gifts.refetch()}
          />
        ) : grouped.length === 0 ? (
          <EmptyState
            icon={<GiftIcon className="h-6 w-6" />}
            title="Подарков пока нет"
            description="Каталог скоро пополнится — загляните позже."
          />
        ) : (
          <div className="space-y-12">
            {grouped.map(({ rarity, gifts: list }) => {
              const style = RARITY_STYLES[rarity];
              return (
                <section key={rarity} aria-labelledby={`rarity-${rarity}`}>
                  <div className="mb-4 flex items-center gap-3">
                    <h2
                      id={`rarity-${rarity}`}
                      className="font-display text-lg font-bold tracking-tight"
                      style={{ color: style.color }}
                    >
                      {style.label}
                    </h2>
                    <Badge variant={style.badge} size="sm">
                      {list.length}
                    </Badge>
                    <span
                      aria-hidden="true"
                      className="h-px flex-1"
                      style={{ background: `linear-gradient(to right, color-mix(in oklch, ${style.color} 40%, transparent), transparent)` }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {list.map((gift, i) => (
                      <GiftCard
                        key={gift.id}
                        gift={gift}
                        index={i}
                        isPremium={isPremium}
                        onSend={setSelected}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </EconomyShell>

      <SendGiftDialog
        gift={selected}
        isPremium={isPremium}
        context="profile"
        onClose={() => setSelected(null)}
      />
    </TooltipProvider>
  );
}
