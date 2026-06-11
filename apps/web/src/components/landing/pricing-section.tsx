/**
 * Landing — "Pricing / Premium" section.
 *
 * Server component. Three plain pricing cards (Free, Premium Monthly, Premium
 * Yearly) — the prices are real (399 ₽/mo and 3499 ₽/yr, mirroring the seed
 * plans in `apps/api/src/modules/premium/premium.service.ts`) so the
 * `SoftwareApplication` AggregateOffer in the structured data tracks what
 * users actually see.
 *
 * Each card's "perks" list is rendered from a real `<ul>` (not a div pretending
 * to be a list) so screen-readers + crawlers understand the structure.
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { PRICING_TIERS } from './constants';

export async function PricingSection() {
  const t = await getTranslations('landing');

  return (
    <section
      aria-labelledby="landing-pricing"
      className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-3xl text-center">
        <h2
          id="landing-pricing"
          className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
        >
          {t('pricing.title')}
        </h2>
        <p className="mt-4 text-balance text-muted-foreground">{t('pricing.lede')}</p>
      </div>

      <ul className="mt-12 grid gap-5 md:grid-cols-3">
        {PRICING_TIERS.map((tier) => {
          const Icon = tier.icon;
          const perks = t.raw(`pricing.${tier.key}.perks`) as string[];
          return (
            <li key={tier.key}>
              <article
                className={cn(
                  'glass-panel relative flex h-full flex-col gap-5 rounded-2xl p-6',
                  tier.highlighted &&
                    'ring-1 ring-[var(--color-neon-violet)]/60 shadow-[0_8px_30px_-12px_var(--color-neon-violet)]',
                )}
              >
                {tier.highlighted ? (
                  <span className="absolute -top-3 right-4 rounded-full bg-gradient-to-r from-[var(--color-neon-violet)] to-[var(--color-neon-magenta)] px-3 py-1 text-xs font-bold text-primary-foreground shadow-lg">
                    {t('pricing.lite.popular')}
                  </span>
                ) : null}

                <div
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-0 -z-10 rounded-2xl bg-gradient-to-br opacity-50',
                    tier.accent,
                  )}
                />

                <header className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-card/70 text-foreground ring-1 ring-border/70">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="font-display text-lg font-bold">
                    {t(`pricing.${tier.key}.name`)}
                  </h3>
                </header>

                <div>
                  <p className="font-display text-3xl font-extrabold text-gradient-neon">
                    {t(`pricing.${tier.key}.price`)}
                    <span className="ml-2 text-sm font-medium text-muted-foreground">
                      {t(`pricing.${tier.key}.period`)}
                    </span>
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t(`pricing.${tier.key}.tagline`)}
                  </p>
                </div>

                <ul className="space-y-2 text-sm text-foreground/85">
                  {perks.map((perk) => (
                    <li key={perk} className="flex items-start gap-2">
                      <Check
                        className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-neon-cyan)]"
                        aria-hidden="true"
                      />
                      <span>{perk}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={tier.key === 'free' ? '/register' : tier.href}
                  className={cn(
                    'mt-auto inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-colors',
                    tier.highlighted
                      ? 'bg-gradient-to-r from-[var(--color-neon-violet)] via-[var(--color-neon-magenta)] to-[var(--color-neon-violet)] bg-[length:200%_100%] bg-left text-primary-foreground hover:bg-right'
                      : 'glass-panel hover:bg-card/80',
                  )}
                >
                  {t(`pricing.${tier.key}.cta`)}
                </Link>
              </article>
            </li>
          );
        })}
      </ul>

      <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-muted-foreground">
        {t('pricing.footnote')}
      </p>
    </section>
  );
}
