'use client';

/**
 * /top — the SIGNATURE feed.
 *
 * Two infinite marquee rows from GET /top (lanes `left`/`right`) scrolling in
 * opposite directions (top → right, bottom → left), pausing on hover. Each card
 * links to /profile/[id]. A "buy a spot" flow (POST /top/purchase) lets anyone
 * bid coins for a placement — more coins ⇒ higher rank.
 */
import { useState } from 'react';
import { Crown, Flame, Trophy } from 'lucide-react';
import { Button, TooltipProvider } from '@ruletka/ui';
import { EconomyShell } from '@/components/economy/economy-shell';
import { ErrorState } from '@/components/economy/states';
import { TopFeedMarquee } from '@/components/top/top-feed-marquee';
import { BuySpotDialog } from '@/components/top/buy-spot-dialog';
import { useTopFeed } from '@/features/top/use-top';
import { useCoinBalance } from '@/hooks/wallet/use-wallet';

export default function TopPage() {
  const feed = useTopFeed();
  const balance = useCoinBalance();
  const [buyOpen, setBuyOpen] = useState(false);

  const total = (feed.data?.left.length ?? 0) + (feed.data?.right.length ?? 0);

  return (
    <TooltipProvider delayDuration={200}>
      <EconomyShell
        eyebrow={
          <>
            <Flame className="h-3.5 w-3.5 text-[var(--color-neon-magenta)]" aria-hidden="true" />
            Топ эфира
          </>
        }
        title={
          <>
            Лучшие <span className="text-gradient-neon">в эфире</span>
          </>
        }
        lede="Живая лента самых заметных участников. Купите место — и вас увидят все, кто заходит в рулетку."
        actions={
          <Button
            size="lg"
            leadingIcon={<Crown className="h-5 w-5" />}
            onClick={() => setBuyOpen(true)}
          >
            Купить место
          </Button>
        }
      >
        {feed.isError ? (
          <ErrorState
            title="Не удалось загрузить Топ"
            description="Лента временно недоступна. Попробуйте обновить."
            onRetry={() => feed.refetch()}
          />
        ) : (
          <div className="space-y-8">
            {/* The signature dual marquee. */}
            <div className="relative">
              <TopFeedMarquee
                left={feed.data?.left ?? []}
                right={feed.data?.right ?? []}
                isLoading={feed.isLoading}
              />
            </div>

            {/* Call-to-action band. */}
            <div className="relative overflow-hidden rounded-3xl px-6 py-10 text-center sm:px-12">
              <div
                aria-hidden="true"
                className="absolute inset-0 -z-10 bg-gradient-to-br from-[color-mix(in_oklch,var(--coin)_18%,transparent)] via-card to-[var(--color-neon-violet)]/20"
              />
              <div className="glass-panel absolute inset-0 -z-10 rounded-3xl" aria-hidden="true" />
              <Trophy className="mx-auto h-8 w-8 text-[var(--coin)]" aria-hidden="true" />
              <h2 className="mt-4 font-display text-2xl font-bold tracking-tight sm:text-3xl">
                Хотите оказаться здесь?
              </h2>
              <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
                {total > 0
                  ? `Сейчас в Топе ${total} ${pluralPlaces(total)}. Сделайте ставку выше — и поднимитесь в начало ленты.`
                  : 'Дорожки свободны — станьте первым в Топе прямо сейчас.'}
              </p>
              <Button
                className="mt-6"
                size="lg"
                leadingIcon={<Crown className="h-5 w-5" />}
                onClick={() => setBuyOpen(true)}
              >
                Купить место в Топе
              </Button>
            </div>
          </div>
        )}
      </EconomyShell>

      <BuySpotDialog open={buyOpen} onClose={() => setBuyOpen(false)} balance={balance} />
    </TooltipProvider>
  );
}

/** Russian plural for "места/мест". */
function pluralPlaces(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'участник';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'участника';
  return 'участников';
}
