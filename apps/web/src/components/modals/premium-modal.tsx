'use client';

/**
 * Premium upgrade.
 *
 * - GET /premium/plans (`usePremiumPlans`).
 * - Pick a plan → POST /premium/subscribe (registers intent) then the
 *   CloudPayments *recurrent* widget opens (`useSubscribe`). Entitlement is
 *   granted by the recurrent webhook, so a successful charge shows a "pending"
 *   state.
 *
 * Mirrors the /premium page's flow exactly (shared hooks) so behaviour and
 * copy stay consistent. An optional `reason` line explains why the modal was
 * opened (e.g. a premium-gated filter or gift).
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, CheckCircle2, Crown, Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import type { PremiumPlan } from '@ruletka/shared-types';
import {
  Badge,
  Button,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { useModal, useModalProps } from '@/lib/stores/modal-store';
import { formatRub } from '@/features/economy/format';
import { usePremiumPlans, useSubscribe } from '@/features/premium/use-premium';

type ChromeTranslator = ReturnType<typeof useTranslations>;

/** "per month/week/day" suffix from a plan's interval (localized). */
function intervalSuffix(days: number, t: ChromeTranslator): string {
  if (days % 30 === 0) {
    const months = Math.round(days / 30);
    return months === 1
      ? t('modals.premium.perMonth')
      : t('modals.premium.perMonths', { count: months });
  }
  if (days % 7 === 0) {
    const weeks = Math.round(days / 7);
    return weeks === 1
      ? t('modals.premium.perWeek')
      : t('modals.premium.perWeeks', { count: weeks });
  }
  return days === 1 ? t('modals.premium.perDay') : t('modals.premium.perDays', { count: days });
}

export function PremiumModal() {
  const { close } = useModal();
  const t = useTranslations('chrome');
  const { reason } = useModalProps<'premium'>();
  const plans = usePremiumPlans();
  const subscribe = useSubscribe();

  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  // Default-select the cheapest-per-day (usually the longest) plan once loaded.
  useEffect(() => {
    if (selectedCode || !plans.data || plans.data.length === 0) return;
    const best = [...plans.data].sort(
      (a, b) => a.priceRub / a.intervalDays - b.priceRub / b.intervalDays,
    )[0];
    if (best) setSelectedCode(best.code);
  }, [plans.data, selectedCode]);

  const selected = plans.data?.find((p) => p.code === selectedCode) ?? null;

  // Union of perks across plans for the feature list (deduped, order-preserving).
  const allPerks = Array.from(
    new Set((plans.data ?? []).flatMap((p) => p.perks)),
  ).slice(0, 8);

  // ── Pending / error panels ──
  if (subscribe.phase === 'pending') {
    return (
      <StatusPanel
        icon={<Loader2 className="h-7 w-7 animate-spin text-accent" />}
        title={t('modals.premium.pendingTitle')}
        description={t('modals.premium.pendingDescription')}
      >
        <Button type="button" variant="primary" onClick={() => { subscribe.reset(); close(); }}>
          {t('modals.premium.gotIt')}
        </Button>
      </StatusPanel>
    );
  }
  if (subscribe.phase === 'active') {
    return (
      <StatusPanel
        icon={<CheckCircle2 className="h-7 w-7 text-success" />}
        title={t('modals.premium.activeTitle')}
        description={t('modals.premium.activeDescription')}
      >
        <Button type="button" variant="primary" onClick={() => { subscribe.reset(); close(); }}>
          {t('modals.premium.thanks')}
        </Button>
      </StatusPanel>
    );
  }
  if (subscribe.phase === 'error') {
    return (
      <StatusPanel
        icon={<TriangleAlert className="h-7 w-7 text-danger" />}
        title={t('modals.premium.errorTitle')}
        description={subscribe.error ?? t('modals.premium.errorDescription')}
      >
        <Button type="button" variant="ghost" onClick={subscribe.reset}>
          {t('modals.premium.back')}
        </Button>
        {subscribe.activePlan && (
          <Button type="button" variant="primary" onClick={() => subscribe.subscribe(subscribe.activePlan!)}>
            {t('modals.premium.retry')}
          </Button>
        )}
      </StatusPanel>
    );
  }

  return (
    <>
      <DialogHeader>
        <span className="mb-2 inline-flex w-fit items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-warning">
          <Crown className="h-3.5 w-3.5" aria-hidden="true" />
          {t('modals.premium.eyebrow')}
        </span>
        <DialogTitle>
          {t('modals.premium.titlePrefix')}{' '}
          <span className="text-gradient-neon">{t('modals.premium.titleHighlight')}</span>
        </DialogTitle>
        <DialogDescription>
          {reason ?? t('modals.premium.descDefault')}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        {/* Perks */}
        {plans.isLoading ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 rounded-md" />
            ))}
          </div>
        ) : (
          allPerks.length > 0 && (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {allPerks.map((perk) => (
                <li key={perk} className="flex items-start gap-2 text-sm text-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                  {perk}
                </li>
              ))}
            </ul>
          )
        )}

        {/* Plans */}
        <div className="space-y-2">
          {plans.isLoading &&
            Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}

          {plans.isError && (
            <div className="rounded-xl border border-border/60 bg-card/40 p-6 text-center text-sm text-muted-foreground">
              {t('modals.premium.loadError')}{' '}
              <button
                type="button"
                onClick={() => plans.refetch()}
                className="font-medium text-accent hover:underline"
              >
                {t('modals.premium.retry')}
              </button>
            </div>
          )}

          {plans.data?.map((plan) => (
            <PlanRow
              key={plan.code}
              plan={plan}
              selected={plan.code === selectedCode}
              onSelect={() => setSelectedCode(plan.code)}
            />
          ))}
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close}>
          {t('modals.premium.notNow')}
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={!selected}
          loading={subscribe.isBusy}
          leadingIcon={<Sparkles className="h-4 w-4" />}
          onClick={() => selected && subscribe.subscribe(selected)}
        >
          {selected
            ? t('modals.premium.subscribeFor', { price: formatRub(selected.priceRub) })
            : t('modals.premium.selectPlan')}
        </Button>
      </DialogFooter>
    </>
  );
}

function PlanRow({
  plan,
  selected,
  onSelect,
}: {
  plan: PremiumPlan;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('chrome');
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-accent-muted bg-accent-soft'
          : 'border-border bg-card/40 hover:border-border-strong hover:bg-card/70',
      )}
    >
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          selected ? 'border-accent bg-accent text-accent-foreground' : 'border-border-strong',
        )}
        aria-hidden="true"
      >
        {selected && <Check className="h-3 w-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-medium text-foreground">{plan.title}</span>
        {plan.intervalDays >= 30 && (
          <Badge variant="success" size="sm" className="ml-2">
            {t('modals.premium.planBadge')}
          </Badge>
        )}
      </span>
      <span className="shrink-0 text-right">
        <span className="font-display text-base font-bold tabular-nums text-foreground">
          {formatRub(plan.priceRub)}
        </span>
        <span className="text-xs text-muted-foreground">{intervalSuffix(plan.intervalDays, t)}</span>
      </span>
    </button>
  );
}

function StatusPanel({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-card/60 ring-1 ring-border/70">
          {icon}
        </span>
        <div className="space-y-1">
          <DialogTitle className="text-lg">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>
      </div>
      <DialogFooter className="sm:justify-center">{children}</DialogFooter>
    </>
  );
}
