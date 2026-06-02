import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProfilePageShell } from '@/components/profile/profile-page-shell';
import { PublicProfileClient } from '@/features/profile/public-profile-client';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('profile');
  return {
    title: t('meta.publicTitle'),
    description: t('meta.publicDescription'),
  };
}

/**
 * /profile/[id] — a public profile. `params` is async (App Router); the client
 * body loads the profile, presence and gifts, and exposes the action bar.
 */
export default async function PublicProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ProfilePageShell>
      <PublicProfileClient profileId={id} />
    </ProfilePageShell>
  );
}
