import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProfilePageShell } from '@/components/profile/profile-page-shell';
import { MyProfileEditClient } from '@/features/profile/my-profile-edit-client';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('profile');
  return {
    title: t('meta.editTitle'),
  };
}

/** /profile/me/edit — standalone profile editor. */
export default function MyProfileEditPage() {
  return (
    <ProfilePageShell>
      <MyProfileEditClient />
    </ProfilePageShell>
  );
}
