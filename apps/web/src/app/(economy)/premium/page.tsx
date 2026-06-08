import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PremiumClient } from './premium-client';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('economy');
  return {
    title: t('pageMeta.premiumTitle'),
    description: t('pageMeta.premiumDescription'),
    // Account-bound billing surface — keep it out of search indexes.
    robots: { index: false, follow: false },
  };
}

/**
 * /premium — plans, perks, subscribe & manage.
 *
 * Thin server shell: exports localized metadata and renders the interactive
 * {@link PremiumClient}, which owns the plans + subscription flow.
 */
export default function PremiumPage() {
  return <PremiumClient />;
}
