import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { TopClient } from './top-client';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('economy');
  return {
    title: t('pageMeta.topTitle'),
    description: t('pageMeta.topDescription'),
  };
}

/**
 * /top — the SIGNATURE feed.
 *
 * Thin server shell: exports localized metadata (this is the one economy page we
 * keep indexable — it's a public, marketing-grade showcase) and renders the
 * interactive {@link TopClient}, which owns the live feed + buy-spot flow.
 */
export default function TopPage() {
  return <TopClient />;
}
