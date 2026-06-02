'use client';

/**
 * A premium plan card — aurora-accented glass with a perks checklist, monthly
 * price, and a subscribe CTA. The middle/featured plan gets the gradient border
 * and a "популярный" ribbon.
 */
import { motion } from 'framer-motion';
import { Check, Crown, Sparkles } from 'lucide-react';
import type { PremiumPlan } from '@ruletka/shared-types';
import { Badge, Button } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { formatRub } from '@/features/economy/format';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

function cadence(intervalDays: number): string {
  if (intervalDays % 30 === 0) {
    const m = Math.round(intervalDays / 30);
    return m === 1 ? 'в месяц' : `за ${m} мес.`;
  }
  if (intervalDays % 7 === 0) {
    const w = Math.round(intervalDays / 7);
    return w === 1 ? 'в неделю' : `за ${w} нед.`;
  }
  return intervalDays === 1 ? 'в день' : `за ${intervalDays} дн.`;
}

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

export function PlanCard({
  plan,
  featured = false,
  current = false,
  loading = false,
  disabled = false,
  onSubscribe,
  index = 0,
}: PlanCardProps) {
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
                Активно
              </Badge>
            ) : (
              <Badge variant="aurora" size="sm">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                Популярный
              </Badge>
            )}
          </span>
        )}

        <div className="flex items-center gap-2">
          <Crown
            className={cn('h-5 w-5', featured ? 'text-[var(--color-neon-magenta)]' : 'text-warning')}
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

        <Button
          className="mt-7"
          block
          variant={featured ? 'primary' : 'secondary'}
          loading={loading}
          disabled={(disabled && !loading) || current}
          onClick={() => onSubscribe(plan)}
        >
          {current ? 'Текущий план' : 'Оформить'}
        </Button>
      </div>
    </motion.div>
  );
}
