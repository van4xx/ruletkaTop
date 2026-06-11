import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProfilePageShell } from '@/components/profile/profile-page-shell';
import { MyAchievementsClient } from '@/features/achievements/my-achievements-client';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('profile');
  return {
    title: t('achievements.meta.title'),
    description: t('achievements.meta.description'),
  };
}

/**
 * /profile/me/achievements — full 4-column grid of every catalogue achievement
 * with unlock status, criteria text, and tier glow. Auth-gated client body.
 */
export default function MyAchievementsPage() {
  return (
    <ProfilePageShell>
      <MyAchievementsClient />
    </ProfilePageShell>
  );
}
