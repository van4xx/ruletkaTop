import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LegalDocPage } from '@/components/legal/documents';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal');
  return {
    title: t('help.metaTitle'),
    description: t('help.metaDescription'),
  };
}

export default function HelpPage() {
  return <LegalDocPage id="help" />;
}
