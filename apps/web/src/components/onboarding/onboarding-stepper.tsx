'use client';

/**
 * Horizontal progress stepper for the onboarding flow. Shows ordered steps with
 * a connecting neon track that fills with progress, the current step highlighted,
 * and completed steps ticked. Collapses to a compact "Шаг N из M" + progress bar
 * on small screens.
 */
import { Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

export interface StepperStep {
  key: string;
  /** `misc.onboarding.*` key for the step label. */
  labelKey: string;
}

export function OnboardingStepper({
  steps,
  current,
}: {
  steps: StepperStep[];
  /** Zero-based index of the active step. */
  current: number;
}) {
  const t = useTranslations('misc');
  const total = steps.length;
  const progress = total > 1 ? current / (total - 1) : 0;

  return (
    <div className="w-full">
      {/* Mobile: compact label + bar */}
      <div className="sm:hidden">
        <div className="flex items-baseline justify-between">
          <p className="font-display text-sm font-semibold">{steps[current] ? t(steps[current]!.labelKey) : ''}</p>
          <p className="text-xs text-muted-foreground">
            {t('onboarding.stepCounter', { current: current + 1, total })}
          </p>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-card/70 ring-1 ring-border/60">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-[var(--color-neon-violet)] via-[var(--color-neon-magenta)] to-[var(--color-neon-cyan)]"
            initial={false}
            animate={{ width: `${((current + 1) / total) * 100}%` }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
      </div>

      {/* Desktop: full stepper with connecting track */}
      <ol className="relative hidden items-center justify-between sm:flex">
        {/* Track (behind the nodes). */}
        <div
          aria-hidden="true"
          className="absolute left-0 right-0 top-4 mx-5 h-0.5 -translate-y-1/2 rounded-full bg-border/70"
        />
        <motion.div
          aria-hidden="true"
          className="absolute left-0 top-4 mx-5 h-0.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-[var(--color-neon-violet)] to-[var(--color-neon-cyan)]"
          initial={false}
          animate={{ width: `calc(${progress * 100}% - ${progress * 40}px)` }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        />

        {steps.map((step, i) => {
          const isDone = i < current;
          const isCurrent = i === current;
          return (
            <li key={step.key} className="relative z-10 flex flex-col items-center gap-2">
              <span
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ring-1 transition-colors',
                  isDone && 'bg-[var(--color-neon-violet)]/20 text-foreground ring-[var(--color-neon-violet)]/50',
                  isCurrent &&
                    'bg-gradient-to-br from-[var(--color-neon-violet)] to-[var(--color-neon-magenta)] text-primary-foreground ring-transparent shadow-[0_4px_16px_-4px_var(--color-neon-violet)]',
                  !isDone && !isCurrent && 'bg-card/70 text-muted-foreground ring-border/60',
                )}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {isDone ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
              </span>
              <span
                className={cn(
                  'max-w-[7rem] text-center text-xs font-medium leading-tight',
                  isCurrent ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {t(step.labelKey)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
