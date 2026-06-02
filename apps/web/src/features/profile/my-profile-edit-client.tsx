'use client';

/**
 * Standalone editor body for /profile/me/edit — the same {@link ProfileEditForm}
 * as the inline editor, but as its own deep-linkable route. On save it routes
 * back to /profile/me.
 */
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { Button, Card, CardHeader, CardTitle } from '@ruletka/ui';
import { ROUTES } from '@/config/nav';
import { useAuth } from '@/features/auth';
import { ErrorState, SignInRequired } from '@/components/social/state-views';
import { ProfileSkeleton } from '@/components/profile/profile-skeleton';
import { useProfile } from './use-profile';
import { ProfileEditForm } from './profile-edit-form';

export function MyProfileEditClient() {
  const t = useTranslations('profile');
  const router = useRouter();
  const { user, isAuthenticated, isReady } = useAuth();
  const profileQuery = useProfile(user?.id);

  if (isReady && !isAuthenticated) {
    return <SignInRequired description={t('myProfileEdit.signInRequired')} />;
  }
  if (!user || profileQuery.isLoading) return <ProfileSkeleton />;
  if (profileQuery.isError) return <ErrorState onRetry={() => void profileQuery.refetch()} />;

  return (
    <div className="space-y-5">
      <div>
        <Button asChild variant="ghost" size="sm" leadingIcon={<ArrowLeft className="h-4 w-4" />}>
          <Link href={ROUTES.me}>{t('myProfileEdit.back')}</Link>
        </Button>
      </div>
      <Card variant="glass" padding="md">
        <CardHeader className="mb-4">
          <CardTitle>{t('myProfileEdit.editTitle')}</CardTitle>
        </CardHeader>
        <ProfileEditForm profile={profileQuery.data!} onDone={() => router.push(ROUTES.me)} />
      </Card>
    </div>
  );
}
