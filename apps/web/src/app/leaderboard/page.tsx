import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LeaderboardClient } from '@/components/leaderboard/leaderboard-client';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('misc');
  return {
    title: t('leaderboard.metaTitle'),
    description: t('leaderboard.metaDescription'),
  };
}

/**
 * /leaderboard — community hall-of-fame. The interactive board (podium + ranked
 * list, derived from the live Top feed) lives in the client component.
 */
export default function LeaderboardPage() {
  return <LeaderboardClient />;
}
