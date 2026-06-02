'use client';

/**
 * "Buy a spot in the Top" flow. Collects a lane, duration, and coin bid
 * (validated against the shared `topPurchaseSchema`), then POST /top/purchase.
 * More coins ⇒ higher rank within the lane, so the form makes the bid the hero
 * input. Surfaces the 402/422 insufficient-balance case with a top-up prompt.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { ArrowLeftToLine, ArrowRightToLine, Coins, Crown, Trophy } from 'lucide-react';
import { topPurchaseSchema, type TopLane, type TopPurchaseDto } from '@ruletka/shared-types';
import {
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
  Slider,
  toast,
} from '@ruletka/ui';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/features/economy/format';
import { usePurchaseTop } from '@/features/top/use-top';

const DURATION_PRESETS = [
  { hours: 6, key: 'preset6h' },
  { hours: 24, key: 'preset1d' },
  { hours: 72, key: 'preset3d' },
  { hours: 168, key: 'preset7d' },
] as const;

const MIN_COINS = 100;

export interface BuySpotDialogProps {
  open: boolean;
  onClose: () => void;
  balance: number | null;
}

export function BuySpotDialog({ open, onClose, balance }: BuySpotDialogProps) {
  const t = useTranslations('economy');
  const tc = useTranslations('common');
  const purchase = usePurchaseTop();
  const [duration, setDuration] = useState(24);

  const {
    control,
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<TopPurchaseDto>({
    resolver: zodResolver(topPurchaseSchema),
    defaultValues: { lane: 'left', durationHours: 24, coins: 500 },
  });

  const lane = watch('lane');
  const coins = Number(watch('coins')) || 0;
  const insufficient = balance !== null && coins > balance;

  const close = () => {
    reset({ lane: 'left', durationHours: 24, coins: 500 });
    setDuration(24);
    onClose();
  };

  const onSubmit = (values: TopPurchaseDto) => {
    purchase.mutate(values, {
      onSuccess: () => {
        toast.success(t('buySpot.toastSuccess'), {
          description:
            values.lane === 'left' ? t('buySpot.toastSuccessTop') : t('buySpot.toastSuccessBottom'),
        });
        close();
      },
      onError: (err) => {
        if (err instanceof ApiClientError && (err.status === 402 || err.status === 422)) {
          toast.error(t('buySpot.errorInsufficient'), {
            description: t('buySpot.errorInsufficientDescription'),
          });
          return;
        }
        toast.error(t('buySpot.errorGeneric'));
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-[var(--coin)]" aria-hidden="true" />
            {t('buySpot.title')}
          </DialogTitle>
          <DialogDescription>{t('buySpot.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Lane picker */}
          <fieldset className="space-y-2">
            <Label>{t('buySpot.laneLabel')}</Label>
            <div
              className="grid grid-cols-2 gap-3"
              role="radiogroup"
              aria-label={t('buySpot.laneLabel')}
            >
              {(
                [
                  { value: 'left' as TopLane, label: t('buySpot.laneTop'), icon: ArrowRightToLine },
                  {
                    value: 'right' as TopLane,
                    label: t('buySpot.laneBottom'),
                    icon: ArrowLeftToLine,
                  },
                ] as const
              ).map(({ value, label, icon: Icon }) => {
                const active = lane === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setValue('lane', value, { shouldValidate: true })}
                    className={cn(
                      'flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition-colors',
                      active
                        ? 'border-[var(--color-neon-violet)]/60 bg-primary/12 text-foreground'
                        : 'border-border/70 bg-card/40 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* Duration */}
          <fieldset className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="duration-slider">{t('buySpot.durationLabel')}</Label>
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {t('buySpot.durationValue', { hours: duration })}
              </span>
            </div>
            <Controller
              control={control}
              name="durationHours"
              render={({ field }) => (
                <Slider
                  id="duration-slider"
                  min={1}
                  max={168}
                  step={1}
                  value={[field.value]}
                  onValueChange={(v) => {
                    const next = v[0] ?? 1;
                    field.onChange(next);
                    setDuration(next);
                  }}
                  aria-label={t('buySpot.durationSliderAria')}
                />
              )}
            />
            <div className="flex flex-wrap gap-2">
              {DURATION_PRESETS.map((p) => (
                <button
                  key={p.hours}
                  type="button"
                  onClick={() => {
                    setValue('durationHours', p.hours, { shouldValidate: true });
                    setDuration(p.hours);
                  }}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    duration === p.hours
                      ? 'border-[var(--color-neon-violet)]/60 bg-primary/12 text-foreground'
                      : 'border-border/70 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`buySpot.${p.key}`)}
                </button>
              ))}
            </div>
            {errors.durationHours && (
              <p className="text-xs text-destructive">{errors.durationHours.message}</p>
            )}
          </fieldset>

          {/* Coin bid */}
          <fieldset className="space-y-1.5">
            <Label htmlFor="coins" required>
              {t('buySpot.coinsLabel')}
            </Label>
            <Input
              id="coins"
              type="number"
              min={MIN_COINS}
              step={50}
              leadingIcon={<CoinIcon size="sm" className="text-[var(--coin)]" />}
              invalid={!!errors.coins || insufficient}
              {...register('coins', { valueAsNumber: true })}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {balance !== null
                  ? t.rich('buySpot.balanceLine', {
                      amount: formatNumber(balance),
                      num: (chunks) => <span className="tabular-nums">{chunks}</span>,
                    })
                  : t('buySpot.minCoins')}
              </p>
              {insufficient && (
                <Link
                  href="/coins"
                  className="text-xs font-semibold text-[var(--color-neon-cyan)] hover:underline"
                >
                  {t('buySpot.topUp')}
                </Link>
              )}
            </div>
            {errors.coins && <p className="text-xs text-destructive">{errors.coins.message}</p>}
            {insufficient && !errors.coins && (
              <p className="text-xs text-destructive">{t('buySpot.insufficient')}</p>
            )}
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              {tc('cancel')}
            </Button>
            <Button
              type="submit"
              loading={purchase.isPending}
              disabled={insufficient}
              leadingIcon={<Crown className="h-4 w-4" />}
            >
              {t('buySpot.submit', { amount: formatNumber(coins) })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
