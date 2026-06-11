/**
 * Landing — FAQ section.
 *
 * Server component. Native `<details>` / `<summary>` so the questions and
 * answers are in the initial HTML (crawlable + screen-reader friendly) AND
 * expand/collapse with ZERO client JS. The same Q+A list also drives the
 * `FAQPage` JSON-LD in `page.tsx` so the structured data and the visible
 * markup match 1:1 — Google's QA snippet eligibility is built on that match.
 *
 * Brief asks for 8–10 items; landing.json ships exactly 10 — see `FAQ_COUNT`
 * in `./constants` if the count ever changes.
 */
import { getTranslations } from 'next-intl/server';
import { ChevronDown, HelpCircle } from 'lucide-react';

interface FaqItem {
  q: string;
  a: string;
}

export async function FaqSection() {
  const t = await getTranslations('landing');
  const items = t.raw('faq.items') as FaqItem[];

  return (
    <section
      aria-labelledby="landing-faq"
      className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-3xl text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-border/60 px-3 py-1 text-xs font-medium text-muted-foreground">
          <HelpCircle className="h-3.5 w-3.5 text-[var(--color-neon-magenta)]" aria-hidden="true" />
          FAQ
        </span>
        <h2
          id="landing-faq"
          className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl"
        >
          {t('faq.title')}
        </h2>
        <p className="mt-3 text-balance text-muted-foreground">{t('faq.lede')}</p>
      </div>

      <dl className="mx-auto mt-10 max-w-3xl space-y-3">
        {items.map((item, i) => (
          <details
            key={i}
            className="glass-panel group rounded-2xl p-0 open:shadow-[0_8px_30px_-16px_var(--color-neon-violet)]"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-4 [&::-webkit-details-marker]:hidden">
              <dt className="font-display text-base font-bold leading-snug">{item.q}</dt>
              <ChevronDown
                className="h-5 w-5 flex-shrink-0 text-muted-foreground transition-transform duration-300 group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <dd className="px-5 pb-5 text-sm leading-7 text-muted-foreground">{item.a}</dd>
          </details>
        ))}
      </dl>
    </section>
  );
}
