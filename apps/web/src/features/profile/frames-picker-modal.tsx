'use client';

/**
 * Pick / buy / equip an avatar-frame cosmetic — the owner's "change frame".
 *
 * Mirrors {@link CoverPickerModal} step-for-step:
 *  - GET /frames/catalogue (via `useFrames`) → the 10-frame catalogue rendered
 *    as live mini-previews around a small placeholder avatar; motion is
 *    DISABLED in the grid so 10 thumbnails never animate at once (low-end
 *    jank guard).
 *  - GET /frames/owned (`useMyFrames`) → which frames are owned + equipped.
 *  - Owned/free frame tap → EQUIP it (POST /frames/equip); the hero updates
 *    instantly via the profile detail cache.
 *  - Locked frame → confirm panel with the live balance + price → BUY (POST
 *    /frames/purchase), which auto-equips on success. Insufficient balance
 *    reuses the shared `InsufficientCoins` banner → buy-coins modal.
 *  - "Remove frame" button → POST /frames/equip with `frameId: null`, so the
 *    avatar renders bare (frames are OPTIONAL — the structural difference
 *    from covers).
 *
 * Only ever acts on the CALLER's own profile.
 */
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Check, Lock, Sparkles, X as XIcon } from 'lucide-react';
import type { FrameDesign, FrameId } from '@ruletka/shared-types';
import {
  Button,
  CoinIcon,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  toast,
} from '@ruletka/ui';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useModal } from '@/lib/stores/modal-store';
import { formatNumber } from '@/features/economy/format';
import { useCoinBalance } from '@/hooks/wallet/use-wallet';
import { BalancePill, InsufficientCoins } from '@/components/modals/shared';
import { FRAME_PRESETS } from '@/components/profile/frame-presets';
import { useEquipFrame, useFrames, useMyFrames, usePurchaseFrame } from './use-frames';

/**
 * A motion-disabled frame thumbnail. Renders the real preset layers around
 * a small placeholder avatar disk so the user previews how the frame looks
 * around an actual avatar (not floating in space).
 */
function FrameThumb({ frameId, className }: { frameId: FrameId; className?: string }) {
  const preset = FRAME_PRESETS[frameId];
  if (!preset) return <div className={cn('rounded-full bg-card/40', className)} aria-hidden="true" />;
  const { Layers } = preset;
  return (
    <div
      className={cn('relative grid place-items-center', className)}
      aria-hidden="true"
    >
      {/* Inset the frame layer 16px from the wrapper so the visible avatar
          mirrors the production size relationship (16px on every side). */}
      <div className="absolute inset-0">
        <Layers reduce />
      </div>
      {/* Placeholder avatar disk — same brand gradient as the real fallback. */}
      <div className="size-12 rounded-full bg-[linear-gradient(135deg,var(--color-neon-violet),var(--color-neon-magenta)_55%,var(--color-neon-cyan))] ring-2 ring-background" />
    </div>
  );
}

export function FramesPickerModal() {
  const { close } = useModal();
  const t = useTranslations('profile.frames');

  const catalogue = useFrames();
  const mine = useMyFrames();
  const balance = useCoinBalance();
  const purchase = usePurchaseFrame();
  const equip = useEquipFrame();

  const [selected, setSelected] = useState<FrameDesign | null>(null);

  const ownedSet = useMemo(() => new Set(mine.data?.owned ?? []), [mine.data]);
  const equipped = mine.data?.equipped ?? null;

  const frameName = (frame: FrameDesign): string => t(`names.${frame.id}`);

  const isOwned = (id: string) => ownedSet.has(id as FrameId);
  const insufficient =
    selected != null &&
    balance != null &&
    !isOwned(selected.id) &&
    balance < selected.priceCoins;

  function doEquip(frameId: FrameId | null) {
    equip.mutate(frameId, {
      onSuccess: () => {
        toast.success(t(frameId === null ? 'removedTitle' : 'equippedTitle'));
        close();
      },
      onError: () => toast.error(t('errGeneric')),
    });
  }

  function handleSelect(frame: FrameDesign) {
    if (isOwned(frame.id)) {
      doEquip(frame.id);
      return;
    }
    setSelected(frame);
  }

  function handleBuy() {
    if (!selected) return;
    purchase.mutate(selected.id, {
      onSuccess: () => {
        toast.success(t('purchasedTitle'), {
          description: t('purchasedDescription', { name: frameName(selected) }),
        });
        close();
      },
      onError: (err) => {
        if (err instanceof ApiClientError && (err.status === 402 || err.status === 422)) {
          toast.error(t('errInsufficientTitle'), {
            description: t('errInsufficientDescription'),
          });
          return;
        }
        toast.error(t('errGeneric'));
      },
    });
  }

  const busy = purchase.isPending || equip.isPending;

  return (
    <>
      <DialogHeader>
        <div className="flex items-center justify-between gap-2 pr-8">
          <DialogTitle>{selected ? t('titleConfirm') : t('titleSelect')}</DialogTitle>
          <BalancePill balance={balance} />
        </div>
        <DialogDescription>
          {selected ? t('descConfirm') : t('descSelect')}
        </DialogDescription>
      </DialogHeader>

      {/* ── Step 1: catalogue grid ──────────────────────────────────────── */}
      {!selected && (
        <div className="max-h-[58vh] overflow-y-auto pr-1">
          {catalogue.isLoading && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-xl" />
              ))}
            </div>
          )}

          {catalogue.isError && (
            <div className="rounded-xl border border-border/60 bg-card/40 p-6 text-center text-sm text-muted-foreground">
              {t('loadError')}{' '}
              <button
                type="button"
                onClick={() => catalogue.refetch()}
                className="font-medium text-accent hover:underline"
              >
                {t('retry')}
              </button>
            </div>
          )}

          {!catalogue.isLoading && !catalogue.isError && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(catalogue.data ?? []).map((frame) => {
                const owned = isOwned(frame.id);
                const isEquipped = equipped === frame.id;
                return (
                  <li key={frame.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleSelect(frame)}
                      aria-label={
                        owned
                          ? t('equipAria', { name: frameName(frame) })
                          : t('buyAria', {
                              name: frameName(frame),
                              price: formatNumber(frame.priceCoins),
                            })
                      }
                      className={cn(
                        'group relative block w-full overflow-hidden rounded-2xl border bg-card/40 text-left transition-all',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isEquipped
                          ? 'border-[var(--color-neon-cyan)] ring-1 ring-[var(--color-neon-cyan)]/60'
                          : 'border-border/60 hover:border-accent-muted hover:shadow-lg',
                        busy && 'pointer-events-none opacity-60',
                      )}
                    >
                      <FrameThumb frameId={frame.id} className="aspect-square w-full" />

                      {/* Equipped / locked corner badge. */}
                      {isEquipped ? (
                        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-[var(--color-neon-cyan)] px-2 py-0.5 text-[0.6875rem] font-semibold text-[var(--color-background)] shadow">
                          <Check className="h-3 w-3" aria-hidden="true" />
                          {t('equipped')}
                        </span>
                      ) : (
                        !owned && (
                          <span
                            className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-background)]/75 text-foreground backdrop-blur-sm"
                            title={t('locked')}
                          >
                            <Lock className="h-3 w-3" aria-hidden="true" />
                          </span>
                        )
                      )}

                      {/* Footer: name + (price | owned). */}
                      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                        <span className="truncate text-sm font-semibold text-foreground">
                          {frameName(frame)}
                        </span>
                        {owned ? (
                          <span className="shrink-0 text-xs font-medium text-muted-foreground">
                            {frame.tier === 'free' ? t('free') : t('owned')}
                          </span>
                        ) : (
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold tabular-nums text-[var(--coin)]">
                            <CoinIcon size="xs" />
                            {formatNumber(frame.priceCoins)}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* ── Step 2: confirm + buy ───────────────────────────────────────── */}
      {selected && (
        <div className="space-y-5">
          <div className="overflow-hidden rounded-2xl border border-border/60 p-6">
            <FrameThumb frameId={selected.id} className="mx-auto aspect-square w-40" />
            <div className="mt-4 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-display text-base font-bold text-foreground">
                  {frameName(selected)}
                </p>
                <p className="text-xs text-muted-foreground">{t('flagshipHint')}</p>
              </div>
              <div className="inline-flex shrink-0 items-center gap-1.5">
                <CoinIcon size="sm" className="text-[var(--coin)]" />
                <span className="text-sm font-bold tabular-nums">
                  {formatNumber(selected.priceCoins)}
                </span>
              </div>
            </div>
          </div>

          {insufficient && <InsufficientCoins balance={balance} needed={selected.priceCoins} />}

          <p className="text-center text-xs text-muted-foreground">{t('permanentNote')}</p>
        </div>
      )}

      <DialogFooter className={cn(selected ? 'sm:justify-between' : 'sm:justify-between')}>
        {selected ? (
          <Button
            type="button"
            variant="ghost"
            leadingIcon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => setSelected(null)}
          >
            {t('backToCatalog')}
          </Button>
        ) : (
          <div className="flex w-full items-center justify-between gap-2 sm:w-auto">
            {/* Unequip — only meaningful when SOMETHING is equipped. */}
            {equipped !== null && (
              <Button
                type="button"
                variant="ghost"
                leadingIcon={<XIcon className="h-4 w-4" />}
                onClick={() => doEquip(null)}
                disabled={busy}
              >
                {t('removeFrame')}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={close}>
              {t('close')}
            </Button>
          </div>
        )}

        {selected && (
          <Button
            type="button"
            variant="primary"
            disabled={insufficient}
            loading={purchase.isPending}
            leadingIcon={<Sparkles className="h-4 w-4" />}
            onClick={handleBuy}
          >
            {t('buyFor', { price: formatNumber(selected.priceCoins) })}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
