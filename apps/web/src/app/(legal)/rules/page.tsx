import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LegalDocPage } from '@/components/legal/documents';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal');
  return {
    title: t('rules.metaTitle'),
    description: t('rules.metaDescription'),
  };
}

export default function RulesPage() {
  return <LegalDocPage id="rules" />;
}
