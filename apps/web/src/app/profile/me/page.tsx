import type { Metadata } from 'next';
import { ProfilePageShell } from '@/components/profile/profile-page-shell';
import { MyProfileClient } from '@/features/profile/my-profile-client';

export const metadata: Metadata = {
  title: 'Мой профиль',
  description: 'Ваш профиль, подарки и настройки.',
};

/** /profile/me — the owner's profile with inline editing. */
export default function MyProfilePage() {
  return (
    <ProfilePageShell>
      <MyProfileClient />
    </ProfilePageShell>
  );
}
