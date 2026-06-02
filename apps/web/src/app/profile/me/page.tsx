import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProfilePageShell } from '@/components/profile/profile-page-shell';
import { MyProfileClient } from '@/features/profile/my-profile-client';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('profile');
  return {
    title: t('meta.myTitle'),
    description: t('meta.myDescription'),
  };
}

/** /profile/me — the owner's profile with inline editing. */
export default function MyProfilePage() {
  return (
    <ProfilePageShell>
      <MyProfileClient />
    </ProfilePageShell>
  );
}
