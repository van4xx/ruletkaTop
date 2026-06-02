'use client';

/**
 * "Buy a spot in the Top" flow. Collects a lane, duration, and coin bid
 * (validated against the shared `topPurchaseSchema`), then POST /top/purchase.
 * More coins ⇒ higher rank within the lane, so the form makes the bid the hero
 * input. Surfaces the 402/422 insufficient-balance case with a top-up prompt.
 */
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { ArrowLeftToLine, ArrowRightToLine, Coins, Crown, Trophy } from 'lucide-react';
import {
  topPurchaseSchema,
  type TopLane,
  type TopPurchaseDto,
} from '@ruletka/shared-types';
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
  { hours: 6, label: '6 часов' },
  { hours: 24, label: '1 день' },
  { hours: 72, label: '3 дня' },
  { hours: 168, label: '7 дней' },
] as const;

const MIN_COINS = 100;

export interface BuySpotDialogProps {
  open: boolean;
  onClose: () => void;
  balance: number | null;
}

export function BuySpotDialog({ open, onClose, balance }: BuySpotDialogProps) {
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
        toast.success('Вы в Топе!', {
          description: `Место в ${values.lane === 'left' ? 'верхней' : 'нижней'} дорожке активно.`,
        });
        close();
      },
      onError: (err) => {
        if (err instanceof ApiClientError && (err.status === 402 || err.status === 422)) {
          toast.error('Недостаточно монет', {
            description: 'Пополните баланс, чтобы купить место.',
          });
          return;
        }
        toast.error('Не удалось купить место');
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-[var(--coin)]" aria-hidden="true" />
            Купить место в Топе
          </DialogTitle>
          <DialogDescription>
            Чем больше монет вы вложите, тем выше окажетесь в ленте.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Lane picker */}
          <fieldset className="space-y-2">
            <Label>Дорожка</Label>
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Дорожка">
              {(
                [
                  { value: 'left' as TopLane, label: 'Верхняя', icon: ArrowRightToLine },
                  { value: 'right' as TopLane, label: 'Нижняя', icon: ArrowLeftToLine },
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
              <Label htmlFor="duration-slider">Длительность</Label>
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {duration} ч
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
                  aria-label="Длительность в часах"
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
                  {p.label}
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
              Ставка в монетах
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
                {balance !== null ? (
                  <>
                    Баланс: <span className="tabular-nums">{formatNumber(balance)}</span> монет
                  </>
                ) : (
                  'Минимум 100 монет'
                )}
              </p>
              {insufficient && (
                <Link href="/coins" className="text-xs font-semibold text-[var(--color-neon-cyan)] hover:underline">
                  Пополнить
                </Link>
              )}
            </div>
            {errors.coins && <p className="text-xs text-destructive">{errors.coins.message}</p>}
            {insufficient && !errors.coins && (
              <p className="text-xs text-destructive">Недостаточно монет на балансе.</p>
            )}
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              Отмена
            </Button>
            <Button
              type="submit"
              loading={purchase.isPending}
              disabled={insufficient}
              leadingIcon={<Crown className="h-4 w-4" />}
            >
              Купить за {formatNumber(coins)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
