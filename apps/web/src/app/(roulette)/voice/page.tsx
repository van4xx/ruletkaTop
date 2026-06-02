import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RouletteStage } from '@/features/roulette/roulette-stage';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('roulette');
  return {
    title: t('voice.metaTitle'),
    description: t('voice.metaDescription'),
  };
}

export default function VoiceRoulettePage() {
  return <RouletteStage type="voice" />;
}
