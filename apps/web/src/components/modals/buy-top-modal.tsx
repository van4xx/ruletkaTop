'use client';

/**
 * Buy a Top-feed placement.
 *
 * Validates against the shared `topPurchaseSchema` (lane left/right, duration
 * 1..720h, positive coins) and submits to POST /top/purchase (`usePurchaseTop`,
 * which refetches the feed + wallet on success). A live "priority preview"
 * estimates the resulting placement strength from coins ÷ duration so users see
 * the trade-off before buying. Insufficient balance is gated inline.
 */
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { ArrowDownToLine, ArrowUpToLine, Crown, Trophy } from 'lucide-react';
import { topPurchaseSchema, type TopPurchaseDto } from '@ruletka/shared-types';
import {
  Button,
  CoinIcon,
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
import { useModal, useModalProps } from '@/lib/stores/modal-store';
import { formatNumber } from '@/features/economy/format';
import { usePurchaseTop } from '@/features/top/use-top';
import { useCoinBalance } from '@/hooks/wallet/use-wallet';
import { BalancePill, FieldError, InsufficientCoins } from './shared';

/** Duration presets surfaced as quick chips (hours), with their i18n key. */
const DURATIONS = [
  { hours: 1, key: 'duration1h' },
  { hours: 6, key: 'duration6h' },
  { hours: 24, key: 'duration24h' },
  { hours: 72, key: 'duration72h' },
  { hours: 168, key: 'duration168h' },
] as const;

const MIN_COINS = 10;
const MAX_COINS = 100_000;

/** Qualitative priority tier key from the spend-rate (coins per hour). */
function priorityTier(coins: number, hours: number): { key: string; pct: number } {
  const perHour = hours > 0 ? coins / hours : coins;
  // Map a coins/hour rate onto a 0..100 strength bar (log-ish, capped).
  const pct = Math.max(6, Math.min(100, Math.round((Math.log10(perHour + 1) / 3) * 100)));
  if (pct >= 75) return { key: 'tierMax', pct };
  if (pct >= 45) return { key: 'tierHigh', pct };
  if (pct >= 22) return { key: 'tierMid', pct };
  return { key: 'tierBase', pct };
}

export function BuyTopModal() {
  const { close } = useModal();
  const t = useTranslations('chrome');
  const { presetLane } = useModalProps<'buy-top'>();
  const purchase = usePurchaseTop();
  const balance = useCoinBalance();

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<TopPurchaseDto>({
    resolver: zodResolver(topPurchaseSchema),
    defaultValues: { lane: presetLane ?? 'left', durationHours: 24, coins: 500 },
  });

  const lane = watch('lane');
  const durationHours = watch('durationHours');
  const coins = watch('coins');
  const [coinsText, setCoinsText] = useState(String(500));

  const insufficient = balance != null && coins > balance;
  const tier = useMemo(() => priorityTier(coins || 0, durationHours || 1), [coins, durationHours]);

  const onSubmit = (values: TopPurchaseDto) => {
    purchase.mutate(values, {
      onSuccess: () => {
        const lane =
          values.lane === 'left'
            ? t('modals.buyTop.laneLeftWord')
            : t('modals.buyTop.laneRightWord');
        toast.success(t('modals.buyTop.successTitle'), {
          description: t('modals.buyTop.successDescription', { lane }),
        });
        close();
      },
      onError: (err) => {
        if (err instanceof ApiClientError && (err.status === 402 || err.status === 422)) {
          toast.error(t('modals.buyTop.errInsufficientTitle'), {
            description: t('modals.buyTop.errInsufficientDescription'),
          });
          return;
        }
        toast.error(t('modals.buyTop.errGeneric'));
      },
    });
  };

  return (
    <>
      <DialogHeader>
        <div className="flex items-center justify-between gap-2 pr-8">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/50 px-2.5 py-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
            <Trophy className="h-3.5 w-3.5 text-[var(--color-neon-magenta)]" aria-hidden="true" />
            {t('modals.buyTop.eyebrow')}
          </span>
          <BalancePill balance={balance} />
        </div>
        <DialogTitle>{t('modals.buyTop.title')}</DialogTitle>
        <DialogDescription>{t('modals.buyTop.description')}</DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Lane */}
        <Controller
          control={control}
          name="lane"
          render={({ field }) => (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-foreground">
                {t('modals.buyTop.laneLegend')}
              </legend>
              <div
                role="radiogroup"
                aria-label={t('modals.buyTop.laneAria')}
                className="grid grid-cols-2 gap-2"
              >
                {(
                  [
                    {
                      value: 'left',
                      label: t('modals.buyTop.laneLeft'),
                      icon: ArrowUpToLine,
                      hint: t('modals.buyTop.laneLeftHint'),
                    },
                    {
                      value: 'right',
                      label: t('modals.buyTop.laneRight'),
                      icon: ArrowDownToLine,
                      hint: t('modals.buyTop.laneRightHint'),
                    },
                  ] as const
                ).map((opt) => {
                  const Icon = opt.icon;
                  const selected = field.value === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => field.onChange(opt.value)}
                      className={cn(
                        'flex items-center gap-2.5 rounded-xl border p-3 text-left transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        selected
                          ? 'border-accent-muted bg-accent-soft text-accent'
                          : 'border-border bg-card/40 text-muted-foreground hover:border-border-strong hover:text-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span>
                        <span className="block text-sm font-medium text-foreground">
                          {opt.label}
                        </span>
                        <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
        />

        {/* Duration */}
        <Controller
          control={control}
          name="durationHours"
          render={({ field }) => (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>{t('modals.buyTop.durationLabel')}</Label>
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {t('modals.buyTop.durationValue', { hours: field.value })}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {DURATIONS.map((d) => {
                  const selected = field.value === d.hours;
                  return (
                    <button
                      key={d.hours}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => field.onChange(d.hours)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        selected
                          ? 'border-accent-muted bg-accent-soft text-accent'
                          : 'border-border bg-card/40 text-muted-foreground hover:border-border-strong hover:text-foreground',
                      )}
                    >
                      {t(`modals.buyTop.${d.key}`)}
                    </button>
                  );
                })}
              </div>
              <FieldError>{errors.durationHours?.message}</FieldError>
            </div>
          )}
        />

        {/* Coins */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label htmlFor="top-coins" required>
              {t('modals.buyTop.coinsLabel')}
            </Label>
            <span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums text-[var(--coin)]">
              <CoinIcon size="sm" />
              {formatNumber(coins || 0)}
            </span>
          </div>
          <Controller
            control={control}
            name="coins"
            render={({ field }) => (
              <>
                <Slider
                  min={MIN_COINS}
                  max={Math.max(MIN_COINS, Math.min(MAX_COINS, balance ?? MAX_COINS))}
                  step={10}
                  value={[Math.min(field.value || MIN_COINS, balance ?? MAX_COINS)]}
                  onValueChange={([v]) => {
                    field.onChange(v ?? MIN_COINS);
                    setCoinsText(String(v ?? MIN_COINS));
                  }}
                  aria-label={t('modals.buyTop.coinsAria')}
                  className="mb-3"
                />
                <Input
                  id="top-coins"
                  type="number"
                  inputMode="numeric"
                  min={MIN_COINS}
                  max={MAX_COINS}
                  value={coinsText}
                  invalid={!!errors.coins}
                  leadingIcon={<CoinIcon size="sm" className="text-[var(--coin)]" />}
                  onChange={(e) => {
                    setCoinsText(e.target.value);
                    const n = Number(e.target.value);
                    field.onChange(Number.isFinite(n) ? n : 0);
                  }}
                />
              </>
            )}
          />
          <FieldError>{errors.coins?.message}</FieldError>
        </div>

        {/* Priority preview */}
        <div className="rounded-xl border border-border/60 bg-card/40 p-3.5">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
              <Crown className="h-4 w-4 text-[var(--color-neon-violet)]" aria-hidden="true" />
              {t('modals.buyTop.priorityTitle')}
            </span>
            <span className="font-semibold text-accent">{t(`modals.buyTop.${tier.key}`)}</span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={tier.pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('modals.buyTop.strengthAria')}
          >
            <div
              className="h-full rounded-full bg-aurora transition-[width] duration-300"
              style={{ width: `${tier.pct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('modals.buyTop.priorityNote')}</p>
        </div>

        {insufficient && <InsufficientCoins balance={balance} needed={coins} />}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            {t('modals.buyTop.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={insufficient}
            loading={purchase.isPending}
            leadingIcon={<Trophy className="h-4 w-4" />}
          >
            {t('modals.buyTop.buyFor', { coins: formatNumber(coins || 0) })}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
