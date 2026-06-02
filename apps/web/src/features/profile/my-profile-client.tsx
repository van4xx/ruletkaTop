'use client';

/**
 * Interactive body of /profile/me — the owner's profile.
 *
 * Composes the hero (with an avatar-change entry point), the stats strip
 * (gifts value · own views · friends · Top status), the premium surfaces
 * (upsell card when not premium + the "кто смотрел профиль" panel), and the
 * tabbed sections. An action bar offers copy-id, settings, an avatar change and
 * an inline edit toggle. Editing swaps the tabs for the {@link ProfileEditForm}.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Camera, Check, Copy, Pencil, Settings, X } from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from '@ruletka/ui';
import { useAuth } from '@/features/auth';
import { useModal } from '@/lib/stores/modal-store';
import { useFriends } from '@/features/friends/use-friends';
import { ErrorState, SignInRequired } from '@/components/social/state-views';
import { ProfileHeader } from '@/components/profile/profile-header';
import { ProfileStats } from '@/components/profile/profile-stats';
import { ProfileTabs } from '@/components/profile/profile-tabs';
import { ProfileSkeleton } from '@/components/profile/profile-skeleton';
import { PremiumUpsellCard, ProfileViewsPanel } from '@/components/profile/profile-premium';
import {
  useProfile,
  useProfileGifts,
  useSyncOwnProfileCache,
  useTopPlacement,
} from './use-profile';
import { ProfileEditForm } from './profile-edit-form';

export function MyProfileClient() {
  const t = useTranslations('profile');
  const { user, isAuthenticated, isReady } = useAuth();
  const { open } = useModal();
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const profileQuery = useProfile(user?.id);
  const giftsState = useProfileGifts(user?.id);
  const topPlacement = useTopPlacement(user?.id);
  const friendsQuery = useFriends();
  // Mirror modal-driven avatar/nickname changes into the profile cache.
  useSyncOwnProfileCache(user?.id);

  if (isReady && !isAuthenticated) {
    return <SignInRequired description={t('myProfile.signInRequired')} />;
  }

  if (!user || profileQuery.isLoading) return <ProfileSkeleton />;
  if (profileQuery.isError) return <ErrorState onRetry={() => void profileQuery.refetch()} />;

  const profile = profileQuery.data!;

  async function copyId() {
    try {
      await navigator.clipboard.writeText(profile.id);
      setCopied(true);
      toast.success(t('myProfile.idCopied'));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t('myProfile.copyFailed'));
    }
  }

  const actions = (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton
            variant="glass"
            size="sm"
            aria-label={t('myProfile.changeAvatarAria')}
            onClick={() => open('avatar-upload', { currentUrl: profile.avatarUrl })}
          >
            <Camera aria-hidden="true" />
          </IconButton>
        </TooltipTrigger>
        <TooltipContent>{t('myProfile.changeAvatarAria')}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton
            variant="glass"
            size="sm"
            aria-label={t('myProfile.copyIdAria')}
            onClick={copyId}
          >
            {copied ? (
              <Check className="text-success" aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
          </IconButton>
        </TooltipTrigger>
        <TooltipContent>{t('myProfile.copyIdTooltip')}</TooltipContent>
      </Tooltip>

      <IconButton asChild variant="glass" size="sm" aria-label={t('myProfile.settingsAria')}>
        <Link href="/settings">
          <Settings aria-hidden="true" />
        </Link>
      </IconButton>

      <Button
        variant={editing ? 'secondary' : 'primary'}
        size="sm"
        leadingIcon={editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        onClick={() => setEditing((v) => !v)}
      >
        {editing ? t('myProfile.close') : t('myProfile.edit')}
      </Button>
    </>
  );

  return (
    <div className="space-y-6">
      {/* The owner is, by definition, present while viewing their own profile —
          surface that as a live "online" presence (avatar pulse + status line). */}
      <ProfileHeader profile={profile} status="online" actions={actions} />

      <ProfileStats
        giftsValueCoins={giftsState.totalValueCoins}
        giftsLoading={giftsState.isLoading}
        profileViews={profile.profileViews}
        // The owner can always see their own view count.
        canSeeViews
        isOwnProfile
        friendsCount={friendsQuery.data?.length ?? null}
        friendsLoading={friendsQuery.isLoading}
        isTopPlaced={topPlacement.isPlaced}
        topLoading={topPlacement.isLoading}
      />

      {editing ? (
        <Card variant="glass" padding="md">
          <CardHeader className="mb-4">
            <CardTitle>{t('myProfile.editTitle')}</CardTitle>
          </CardHeader>
          <ProfileEditForm profile={profile} onDone={() => setEditing(false)} />
        </Card>
      ) : (
        <>
          {/* Premium surfaces — upsell for free users, then the views panel. */}
          {!profile.isPremium && <PremiumUpsellCard />}
          <ProfileViewsPanel isPremium={profile.isPremium} views={profile.profileViews} />

          <ProfileTabs
            profile={profile}
            gifts={giftsState.gifts}
            giftsLoading={giftsState.isLoading}
            giftsError={giftsState.isError}
            giftsValueCoins={giftsState.totalValueCoins}
            onRetryGifts={giftsState.refetch}
            isOwnProfile
          />
        </>
      )}
    </div>
  );
}
