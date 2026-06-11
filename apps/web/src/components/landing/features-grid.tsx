/**
 * Landing — "Features" 6-card grid.
 *
 * Server component. Six cards (video, voice, friends, chat, gifts, premium),
 * each with its own H3 + two sentences of real prose drawn from
 * `landing.features.<key>.{title,description}`. Cards link into their
 * respective product surface so crawlers can follow real edges from the home
 * page into the feature pages.
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { LANDING_FEATURES } from './constants';

export async function FeaturesGrid() {
  const t = await getTranslations('landing');
  const tc = await getTranslations('common');

  return (
    <section
      aria-labelledby="landing-features"
      className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-3xl text-center">
        <h2
          id="landing-features"
          className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
        >
          {t('features.title')}
        </h2>
        <p className="mt-4 text-muted-foreground">{t('features.subtitle')}</p>
      </div>

      <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {LANDING_FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <li key={feature.key}>
              <Link
                href={feature.href}
                className="group relative block h-full overflow-hidden rounded-2xl"
              >
                <div
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-0 bg-gradient-to-br opacity-60 transition-opacity duration-300 group-hover:opacity-100',
                    feature.accent,
                  )}
                />
                <div className="glass-panel relative flex h-full flex-col gap-4 rounded-2xl p-6">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-card/70 text-foreground ring-1 ring-border/70">
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <div className="space-y-2">
                    <h3 className="font-display text-lg font-bold">
                      {t(`features.${feature.key}.title`)}
                    </h3>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {t(`features.${feature.key}.description`)}
                    </p>
                  </div>
                  <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-foreground/80 transition-colors group-hover:text-foreground">
                    {tc('learnMore')}
                    <ArrowRight
                      className="h-4 w-4 transition-transform group-hover:translate-x-1"
                      aria-hidden="true"
                    />
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
