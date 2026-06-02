import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RouletteStage } from '@/features/roulette/roulette-stage';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('roulette');
  return {
    title: t('video.metaTitle'),
    description: t('video.metaDescription'),
  };
}

export default function VideoRoulettePage() {
  return <RouletteStage type="video" />;
}
