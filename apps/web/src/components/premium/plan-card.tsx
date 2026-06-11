'use client';

/**
 * A premium plan card — aurora-accented glass with a perks checklist, monthly
 * price, and a subscribe CTA. The middle/featured plan gets the gradient border
 * and a "популярный" ribbon.
 */
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { Check, Crown, Minus, Sparkles, X } from 'lucide-react';
import type { PremiumPlan, PremiumTier } from '@ruletka/shared-types';
import { PREMIUM_TIER_FEATURE_MATRIX } from '@ruletka/shared-types';
import { Badge, Button } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { formatRub } from '@/features/economy/format';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export interface PlanCardProps {
  plan: PremiumPlan;
  featured?: boolean;
  /** This plan is the user's currently-active subscription. */
  current?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onSubscribe: (plan: PremiumPlan) => void;
  index?: number;
}

/**
 * Mirror of the server's `tierForPlanCode` — any code matching `pro` is the
 * Pro tier, everything else Lite. Kept here so the matrix renders the correct
 * `lite` / `pro` column for a given catalogue row without an extra API field.
 */
function tierForPlanCode(code: string): PremiumTier {
  return /pro/i.test(code) ? 'pro' : 'lite';
}

/**
 * Render one matrix-row cell: a check (true / non-false), a cross (false), or
 * the literal value (a number/string surfacing the diff verbatim, like "1.5x"
 * or "500"). The non-trivial value rendering is what makes the Lite-vs-Pro
 * delta scannable at a glance.
 */
function FeatureCell({ value }: { value: boolean | number | string }) {
  if (value === false) {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted/40 text-muted-foreground">
        <X className="h-3 w-3" aria-hidden="true" />
      </span>
    );
  }
  if (value === true) {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-success/15 text-success">
        <Check className="h-3 w-3" aria-hidden="true" />
      </span>
    );
  }
  // Numeric / string — show verbatim, tabular for alignment.
  return (
    <span className="font-mono text-xs font-semibold tabular-nums text-foreground/90">{value}</span>
  );
}

export function PlanCard({
  plan,
  featured = false,
  current = false,
  loading = false,
  disabled = false,
  onSubscribe,
  index = 0,
}: PlanCardProps) {
  const t = useTranslations('economy');
  const tier = tierForPlanCode(plan.code);

  const cadence = (intervalDays: number): string => {
    if (intervalDays % 30 === 0) {
      const m = Math.round(intervalDays / 30);
      return m === 1
        ? t('planCard.cadenceMonthly')
        : t('planCard.cadenceEveryMonths', { count: m });
    }
    if (intervalDays % 7 === 0) {
      const w = Math.round(intervalDays / 7);
      return w === 1 ? t('planCard.cadenceWeekly') : t('planCard.cadenceEveryWeeks', { count: w });
    }
    return intervalDays === 1
      ? t('planCard.cadenceDaily')
      : t('planCard.cadenceEveryDays', { count: intervalDays });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT, delay: index * 0.07 }}
      className={cn('relative flex h-full flex-col', featured && 'lg:-mt-4 lg:mb-4')}
    >
      {/* Gradient border for the featured plan. */}
      {featured && (
        <div
          aria-hidden="true"
          className="absolute -inset-px rounded-3xl bg-gradient-to-b from-[var(--color-neon-violet)] via-[var(--color-neon-magenta)] to-[var(--color-neon-cyan)] opacity-70"
        />
      )}
      <div
        className={cn(
          'glass-panel relative flex h-full flex-col rounded-3xl p-7',
          featured && 'bg-card/80',
        )}
      >
        {(featured || current) && (
          <span className="absolute right-5 top-5">
            {current ? (
              <Badge variant="success" size="sm" dot>
                {t('planCard.active')}
              </Badge>
            ) : (
              <Badge variant="aurora" size="sm">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                {t('planCard.popular')}
              </Badge>
            )}
          </span>
        )}

        <div className="flex items-center gap-2">
          <Crown
            className={cn(
              'h-5 w-5',
              featured ? 'text-[var(--color-neon-magenta)]' : 'text-warning',
            )}
            aria-hidden="true"
          />
          <h3 className="font-display text-lg font-bold tracking-tight">{plan.title}</h3>
        </div>

        <div className="mt-4 flex items-baseline gap-1.5">
          <span className="font-display text-4xl font-extrabold tabular-nums text-foreground">
            {formatRub(plan.priceRub)}
          </span>
          <span className="text-sm text-muted-foreground">{cadence(plan.intervalDays)}</span>
        </div>

        <ul className="mt-6 flex-1 space-y-3">
          {plan.perks.map((perk) => (
            <li key={perk} className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="text-foreground/90">{perk}</span>
            </li>
          ))}
        </ul>

        {/* ── Lite vs Pro feature matrix ──────────────────────────────────
            The six concrete differences, rendered as a compact 3-column
            check/cross/value table. The contract owns the data
            ({@link PREMIUM_TIER_FEATURE_MATRIX}); this card just picks the
            relevant column for THIS plan's tier so the user sees the same
            row across both cards (Lite vs Pro) at a glance. */}
        <div className="mt-5 rounded-2xl border border-border/60 bg-card/40 p-3">
          <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <Minus className="h-3 w-3 opacity-50" aria-hidden="true" />
            {t('planMatrix.title')}
          </div>
          <dl className="divide-y divide-border/40">
            {PREMIUM_TIER_FEATURE_MATRIX.map((row) => (
              <div
                key={row.key}
                className="flex items-center justify-between gap-3 py-1.5 text-xs"
              >
                <dt className="truncate text-foreground/85">{t(`planMatrix.${row.key}`)}</dt>
                <dd className="shrink-0">
                  <FeatureCell value={tier === 'pro' ? row.pro : row.lite} />
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <Button
          className="mt-7"
          block
          variant={featured ? 'primary' : 'secondary'}
          loading={loading}
          disabled={(disabled && !loading) || current}
          onClick={() => onSubscribe(plan)}
        >
          {current ? t('planCard.current') : t('planCard.subscribe')}
        </Button>
      </div>
    </motion.div>
  );
}
