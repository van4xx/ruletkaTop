import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DocumentsHub } from '@/components/legal/documents-hub';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal');
  return {
    title: t('hub.metaTitle'),
    description: t('hub.metaDescription'),
  };
}

export default function DocumentsPage() {
  return <DocumentsHub />;
}
