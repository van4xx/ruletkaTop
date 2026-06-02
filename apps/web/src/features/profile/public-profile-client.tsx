'use client';

/**
 * Interactive body of /profile/[id] (a public profile). Loads the profile,
 * live presence, received gifts and Top-placement status, then composes the
 * hero, the stats strip, the tabbed sections and a modal-driven action bar
 * (message, video, gift, add friend, report, block). When the id is the
 * current user, it redirects to the richer /profile/me editor.
 *
 * All write actions funnel through the unified modal store, so behaviour stays
 * consistent with the rest of the app.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { UserX } from 'lucide-react';
import { Button } from '@ruletka/ui';
import type { OnlineStatus } from '@ruletka/shared-types';
import { ROUTES } from '@/config/nav';
import { ApiClientError } from '@/lib/api';
import { useAuth } from '@/features/auth';
import { usePresence } from '@/features/friends/use-presence';
import { useIsPremium } from '@/features/economy/use-me';
import { ErrorState, StatePanel } from '@/components/social/state-views';
import { ProfileHeader } from '@/components/profile/profile-header';
import { ProfileStats } from '@/components/profile/profile-stats';
import { ProfileTabs } from '@/components/profile/profile-tabs';
import { ProfileActions } from '@/components/profile/profile-actions';
import { ProfileSkeleton } from '@/components/profile/profile-skeleton';
import { useProfile, useProfileGifts, useTopPlacement } from './use-profile';

export function PublicProfileClient({ profileId }: { profileId: string }) {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const viewerIsPremium = useIsPremium();
  const isSelf = user?.id === profileId;

  // Own profile → send to the editor.
  useEffect(() => {
    if (isSelf) router.replace(ROUTES.me);
  }, [isSelf, router]);

  const profileQuery = useProfile(profileId);
  const giftsState = useProfileGifts(profileId);
  const topPlacement = useTopPlacement(profileId);
  const presence = usePresence([profileId]);
  const status: OnlineStatus = presence[profileId] ?? 'offline';

  const [blocked, setBlocked] = useState(false);

  if (profileQuery.isLoading || isSelf) return <ProfileSkeleton />;

  if (profileQuery.isError) {
    const notFound =
      profileQuery.error instanceof ApiClientError && profileQuery.error.status === 404;
    return notFound ? (
      <StatePanel
        title="Профиль не найден"
        description="Возможно, пользователь удалил аккаунт или ссылка неверна."
        action={
          <Button asChild variant="primary" size="sm">
            <Link href={ROUTES.home}>На главную</Link>
          </Button>
        }
      />
    ) : (
      <ErrorState onRetry={() => void profileQuery.refetch()} />
    );
  }

  const profile = profileQuery.data!;

  if (blocked) {
    return (
      <StatePanel
        icon={<UserX className="h-7 w-7" />}
        title={`${profile.nickname} заблокирован`}
        description="Вы больше не будете получать сообщения и звонки от этого пользователя."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href={ROUTES.friends}>К друзьям</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <ProfileHeader
        profile={profile}
        status={status}
        actions={
          <ProfileActions
            profileId={profileId}
            nickname={profile.nickname}
            status={status}
            isAuthenticated={isAuthenticated}
            onBlocked={() => setBlocked(true)}
          />
        }
      />

      <ProfileStats
        giftsValueCoins={giftsState.totalValueCoins}
        giftsLoading={giftsState.isLoading}
        profileViews={profile.profileViews}
        // Other users' view counts are a premium insight.
        canSeeViews={viewerIsPremium}
        isTopPlaced={topPlacement.isPlaced}
        topLoading={topPlacement.isLoading}
      />

      <ProfileTabs
        profile={profile}
        status={status}
        gifts={giftsState.gifts}
        giftsLoading={giftsState.isLoading}
        giftsError={giftsState.isError}
        giftsValueCoins={giftsState.totalValueCoins}
        onRetryGifts={giftsState.refetch}
      />
    </div>
  );
}
