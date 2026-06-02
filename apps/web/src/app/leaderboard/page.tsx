import type { Metadata } from 'next';
import { LeaderboardClient } from '@/components/leaderboard/leaderboard-client';

export const metadata: Metadata = {
  title: 'Зал славы',
  description:
    'Рейтинг лидеров ruletka.top — самые заметные участники сообщества по вкладу в Топ и подаркам.',
};

/**
 * /leaderboard — community hall-of-fame. The interactive board (podium + ranked
 * list, derived from the live Top feed) lives in the client component.
 */
export default function LeaderboardPage() {
  return <LeaderboardClient />;
}
