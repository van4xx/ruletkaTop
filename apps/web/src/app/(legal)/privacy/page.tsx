import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LegalDocPage } from '@/components/legal/documents';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal');
  return {
    title: t('privacy.metaTitle'),
    description: t('privacy.metaDescription'),
  };
}

export default function PrivacyPage() {
  return <LegalDocPage id="privacy" />;
}
