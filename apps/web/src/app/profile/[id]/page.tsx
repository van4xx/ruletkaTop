import type { Metadata } from 'next';
import { ProfilePageShell } from '@/components/profile/profile-page-shell';
import { PublicProfileClient } from '@/features/profile/public-profile-client';

export const metadata: Metadata = {
  title: 'Профиль',
  description: 'Публичный профиль пользователя ruletka.top.',
};

/**
 * /profile/[id] — a public profile. `params` is async (App Router); the client
 * body loads the profile, presence and gifts, and exposes the action bar.
 */
export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <ProfilePageShell>
      <PublicProfileClient profileId={id} />
    </ProfilePageShell>
  );
}
