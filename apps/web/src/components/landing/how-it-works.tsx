/**
 * Landing — "How it works" 3-step section.
 *
 * Server component. H2 + three numbered cards with their own H3 (heading
 * hierarchy is exactly h1 → h2 → h3 across the whole landing). The connector
 * line is decorative (`aria-hidden`) and respects `prefers-reduced-motion`
 * because it is pure CSS.
 */
import { getTranslations } from 'next-intl/server';
import { Workflow } from 'lucide-react';
import { HOW_STEPS } from './constants';

/** Map of step `hue` → the brand neon token used for the badge background. */
const HUE_VAR: Record<'violet' | 'magenta' | 'cyan', string> = {
  violet: 'var(--color-neon-violet)',
  magenta: 'var(--color-neon-magenta)',
  cyan: 'var(--color-neon-cyan)',
};

export async function HowItWorksSection() {
  const t = await getTranslations('landing');

  return (
    <section
      aria-labelledby="landing-how"
      className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-3xl text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-border/60 px-3 py-1 text-xs font-medium text-muted-foreground">
          <Workflow className="h-3.5 w-3.5 text-[var(--color-neon-violet)]" aria-hidden="true" />
          3 шага
        </span>
        <h2
          id="landing-how"
          className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl"
        >
          {t('howItWorks.title')}
        </h2>
        <p className="mt-3 text-balance text-muted-foreground">{t('howItWorks.lede')}</p>
      </div>

      <ol className="mx-auto mt-12 grid max-w-6xl gap-5 md:grid-cols-3">
        {HOW_STEPS.map((step, i) => {
          const Icon = step.icon;
          const accent = HUE_VAR[step.hue];
          return (
            <li
              key={step.key}
              className="glass-panel relative flex flex-col gap-4 rounded-2xl p-6"
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="inline-flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-[0_8px_24px_-12px_currentColor]"
                  style={{
                    background: `linear-gradient(135deg, ${accent}, color-mix(in oklch, ${accent} 50%, transparent))`,
                  }}
                >
                  <Icon className="h-6 w-6" />
                </span>
                <span
                  aria-hidden="true"
                  className="font-display text-2xl font-extrabold text-muted-foreground/70 tabular-nums"
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>
              <h3 className="font-display text-lg font-bold">
                {t(`howItWorks.${step.key}.title`)}
              </h3>
              <p className="text-sm leading-6 text-muted-foreground">
                {t(`howItWorks.${step.key}.text`)}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
