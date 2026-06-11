/**
 * Landing — "What is ruletka.top" prose section.
 *
 * Server component. Three full prose paragraphs of organic-search copy: this is
 * the text-to-chrome lift the page was missing. Every visible string flows
 * through next-intl so ru/en stay 1:1.
 *
 * Intentional internal anchor at the end of paragraph 3 → `/premium` natural
 * link, mirroring the brief's "узнать больше о Premium" example. Helps topical
 * relevance and gives crawlers a friendly path to the funnel page.
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Compass } from 'lucide-react';
import { ROUTES } from '@/config/nav';

export async function WhatIsSection() {
  const t = await getTranslations('landing');

  return (
    <section
      aria-labelledby="landing-what-is"
      className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-3xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-border/60 px-3 py-1 text-xs font-medium text-muted-foreground">
          <Compass className="h-3.5 w-3.5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
          ruletka.top
        </span>
        <h2
          id="landing-what-is"
          className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl"
        >
          {t('whatIs.title')}
        </h2>
        <p className="mt-3 text-balance text-lg text-muted-foreground">{t('whatIs.lede')}</p>

        <div className="mt-8 space-y-5 text-base leading-7 text-foreground/85">
          <p>{t('whatIs.p1')}</p>
          <p>{t('whatIs.p2')}</p>
          <p>
            {t('whatIs.p3')}{' '}
            <Link
              href={ROUTES.premium}
              className="font-medium text-[var(--color-neon-cyan)] underline-offset-4 hover:underline"
            >
              {t('links.premium')}
            </Link>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
