import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { GiftsClient } from './gifts-client';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('economy');
  return {
    title: t('pageMeta.giftsTitle'),
    description: t('pageMeta.giftsDescription'),
    // Behind-the-app commerce surface — keep it out of search indexes.
    robots: { index: false, follow: false },
  };
}

/**
 * /gifts — the gift catalogue.
 *
 * Thin server shell: exports localized metadata and renders the interactive
 * {@link GiftsClient}, which owns the catalogue + send flow.
 */
export default function GiftsPage() {
  return <GiftsClient />;
}
