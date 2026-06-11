'use client';

/**
 * Compact "How it works" panel — three numbered steps + the canonical
 * percentages (10% / 3% / 1%) restated in copy. Kept on the page (not behind a
 * modal) because the brief's UX intent is to surface the rules above the fold
 * for any first-time visitor.
 */
import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';

export function ReferralExplainer() {
  const t = useTranslations('social');
  return (
    <section
      aria-labelledby="ref-explainer-heading"
      className="rounded-2xl border border-border/70 bg-card/40 p-5 sm:p-6"
    >
      <header className="mb-3 flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-card/70 text-[var(--color-neon-cyan)] ring-1 ring-border/70">
          <Info className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 id="ref-explainer-heading" className="font-display text-base font-semibold">
          {t('referrals.explainerTitle')}
        </h2>
      </header>
      <p className="text-sm text-muted-foreground">{t('referrals.explainerBody')}</p>
      <ol className="mt-4 grid gap-2 text-sm">
        <li className="rounded-xl bg-background/40 px-3 py-2">{t('referrals.explainerStep1')}</li>
        <li className="rounded-xl bg-background/40 px-3 py-2">{t('referrals.explainerStep2')}</li>
        <li className="rounded-xl bg-background/40 px-3 py-2">{t('referrals.explainerStep3')}</li>
      </ol>
    </section>
  );
}
