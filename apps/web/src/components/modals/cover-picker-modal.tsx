'use client';

/**
 * Pick / buy / activate a profile-cover cosmetic — the owner's "change cover".
 *
 * - GET /covers (via `useCovers`) → the 10-cover catalogue, each rendered as a
 *   LIVE mini-preview (the real `COVER_PRESETS[id]` layers, motion DISABLED in
 *   the grid so 10 thumbnails never animate at once — the low-end jank guard).
 * - GET /covers/me (`useMyCovers`) → which covers are owned + which is active.
 * - Owned/free cover → tap to ACTIVATE (POST /covers/active); the hero updates
 *   instantly via the profile detail cache.
 * - Locked cover → a confirm panel with the live balance + price → BUY
 *   (POST /covers/purchase), which auto-activates on success. Insufficient
 *   balance reuses the shared `InsufficientCoins` banner → buy-coins modal.
 *
 * Only ever acts on the CALLER's own profile (the endpoints take no target id).
 */
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Check, Lock, Sparkles } from 'lucide-react';
import type { CoverId, ProfileCover } from '@ruletka/shared-types';
import {
  Badge,
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
import {
  useCovers,
  useMyCovers,
  usePurchaseCover,
  useSetActiveCover,
} from '@/features/covers/use-covers';
import { COVER_PRESETS } from '@/components/profile/cover-presets';
import { BalancePill, InsufficientCoins } from './shared';

/** A small, motion-disabled cover thumbnail (the real preset layers). */
function CoverThumb({ coverId, className }: { coverId: CoverId; className?: string }) {
  const preset = COVER_PRESETS[coverId] ?? COVER_PRESETS.aurora;
  const { Layers } = preset;
  return (
    <div className={cn('relative overflow-hidden rounded-xl', className)} aria-hidden="true">
      {/* `reduce` → static gradient only; never animates in the grid. */}
      <Layers reduce />
    </div>
  );
}

export function CoverPickerModal() {
  const { close } = useModal();
  const t = useTranslations('chrome');
  const tCover = useTranslations('profile.cover');

  const catalogue = useCovers();
  const mine = useMyCovers();
  const balance = useCoinBalance();
  const purchase = usePurchaseCover();
  const setActive = useSetActiveCover();

  const [selected, setSelected] = useState<ProfileCover | null>(null);

  const ownedSet = useMemo(() => new Set(mine.data?.owned ?? []), [mine.data]);
  const active = mine.data?.active;

  /** Localised display name for a cover (every id has a `names.<id>` message). */
  const coverName = (cover: ProfileCover): string => tCover(`names.${cover.id}`);

  const isOwned = (id: string) => ownedSet.has(id as CoverId);
  const insufficient =
    selected != null && balance != null && !isOwned(selected.id) && balance < selected.priceCoins;

  function activate(coverId: CoverId) {
    setActive.mutate(coverId, {
      onSuccess: () => {
        toast.success(t('modals.coverPicker.activatedTitle'));
        close();
      },
      onError: () => toast.error(t('modals.coverPicker.errGeneric')),
    });
  }

  function handleSelect(cover: ProfileCover) {
    if (isOwned(cover.id)) {
      // Owned (or free) → activate straight away, no confirm step.
      activate(cover.id);
      return;
    }
    // Locked → go to the confirm/buy panel.
    setSelected(cover);
  }

  function handleBuy() {
    if (!selected) return;
    purchase.mutate(selected.id, {
      onSuccess: () => {
        toast.success(t('modals.coverPicker.purchasedTitle'), {
          description: t('modals.coverPicker.purchasedDescription', { name: coverName(selected) }),
        });
        close();
      },
      onError: (err) => {
        if (err instanceof ApiClientError && (err.status === 402 || err.status === 422)) {
          toast.error(t('modals.coverPicker.errInsufficientTitle'), {
            description: t('modals.coverPicker.errInsufficientDescription'),
          });
          return;
        }
        toast.error(t('modals.coverPicker.errGeneric'));
      },
    });
  }

  const busy = purchase.isPending || setActive.isPending;

  return (
    <>
      <DialogHeader>
        <div className="flex items-center justify-between gap-2 pr-8">
          <DialogTitle>
            {selected ? t('modals.coverPicker.titleConfirm') : t('modals.coverPicker.titleSelect')}
          </DialogTitle>
          <BalancePill balance={balance} />
        </div>
        <DialogDescription>
          {selected ? t('modals.coverPicker.descConfirm') : t('modals.coverPicker.descSelect')}
        </DialogDescription>
      </DialogHeader>

      {/* ── Step 1: catalogue grid ──────────────────────────────────────── */}
      {!selected && (
        <div className="max-h-[58vh] overflow-y-auto pr-1">
          {catalogue.isLoading && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[16/9] rounded-xl" />
              ))}
            </div>
          )}

          {catalogue.isError && (
            <div className="rounded-xl border border-border/60 bg-card/40 p-6 text-center text-sm text-muted-foreground">
              {t('modals.coverPicker.loadError')}{' '}
              <button
                type="button"
                onClick={() => catalogue.refetch()}
                className="font-medium text-accent hover:underline"
              >
                {t('modals.coverPicker.retry')}
              </button>
            </div>
          )}

          {!catalogue.isLoading && !catalogue.isError && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(catalogue.data ?? []).map((cover) => {
                const owned = isOwned(cover.id);
                const isActive = active === cover.id;
                return (
                  <li key={cover.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleSelect(cover)}
                      aria-label={
                        owned
                          ? t('modals.coverPicker.activateAria', { name: coverName(cover) })
                          : t('modals.coverPicker.buyAria', {
                              name: coverName(cover),
                              price: formatNumber(cover.priceCoins),
                            })
                      }
                      className={cn(
                        'group relative block w-full overflow-hidden rounded-2xl border bg-card/40 text-left transition-all',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isActive
                          ? 'border-[var(--color-neon-cyan)] ring-1 ring-[var(--color-neon-cyan)]/60'
                          : 'border-border/60 hover:border-accent-muted hover:shadow-lg',
                        busy && 'pointer-events-none opacity-60',
                      )}
                    >
                      <CoverThumb coverId={cover.id} className="aspect-[16/9] w-full" />

                      {/* Active / locked corner badge. */}
                      {isActive ? (
                        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-[var(--color-neon-cyan)] px-2 py-0.5 text-[0.6875rem] font-semibold text-[var(--color-background)] shadow">
                          <Check className="h-3 w-3" aria-hidden="true" />
                          {t('modals.coverPicker.active')}
                        </span>
                      ) : (
                        !owned && (
                          <span
                            className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-background)]/75 text-foreground backdrop-blur-sm"
                            title={t('modals.coverPicker.locked')}
                          >
                            <Lock className="h-3 w-3" aria-hidden="true" />
                          </span>
                        )
                      )}

                      {/* Footer: name + (price | owned). */}
                      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                        <span className="truncate text-sm font-semibold text-foreground">
                          {coverName(cover)}
                        </span>
                        {owned ? (
                          <span className="shrink-0 text-xs font-medium text-muted-foreground">
                            {cover.tier === 'free'
                              ? t('modals.coverPicker.free')
                              : t('modals.coverPicker.owned')}
                          </span>
                        ) : (
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold tabular-nums text-[var(--coin)]">
                            <CoinIcon size="xs" />
                            {formatNumber(cover.priceCoins)}
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
          {/* Large live preview of the chosen cover (motion disabled for calm). */}
          <div className="overflow-hidden rounded-2xl border border-border/60">
            <CoverThumb coverId={selected.id} className="aspect-[21/9] w-full" />
            <div className="flex items-center justify-between gap-2 bg-card/50 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-display text-base font-bold text-foreground">
                  {coverName(selected)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('modals.coverPicker.flagshipHint')}
                </p>
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

          <p className="text-center text-xs text-muted-foreground">
            {t('modals.coverPicker.permanentNote')}
          </p>
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
            {t('modals.coverPicker.backToCatalog')}
          </Button>
        ) : (
          <Button type="button" variant="ghost" onClick={close}>
            {t('modals.coverPicker.close')}
          </Button>
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
            {t('modals.coverPicker.buyFor', { price: formatNumber(selected.priceCoins) })}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
