import type { Metadata } from 'next';
import { ProfilePageShell } from '@/components/profile/profile-page-shell';
import { MyProfileEditClient } from '@/features/profile/my-profile-edit-client';

export const metadata: Metadata = {
  title: 'Редактирование профиля',
};

/** /profile/me/edit — standalone profile editor. */
export default function MyProfileEditPage() {
  return (
    <ProfilePageShell>
      <MyProfileEditClient />
    </ProfilePageShell>
  );
}
