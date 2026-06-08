'use client';

/**
 * Account tab — avatar + nickname + status edits (PATCH /profile/me), the
 * read-only account email (from the auth user), and a change-password dialog.
 *
 * The profile form uses react-hook-form + the contract `updateProfileSchema`
 * (picked down to the editable fields). Email is immutable here. The AVATAR is
 * NOT a form field — it is an uploaded image managed by the shared avatar-upload
 * modal (file upload to `POST /profiles/me/avatar`); clicking the avatar opens
 * it. Loading, error and saving states are all covered.
 */
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { AtSign, Camera, KeyRound, Quote, UserRound } from 'lucide-react';
import {
  updateProfileSchema,
  type PublicProfile,
  type UpdateProfileDto,
} from '@ruletka/shared-types';
import { Avatar, Button, Input, Skeleton, toast } from '@ruletka/ui';
import { useAuth } from '@/features/auth/use-auth';
import { useProfileMe, useUpdateProfile } from '@/features/settings/use-settings';
import { useFieldError } from '@/features/auth/use-field-error';
import { useErrorMessage } from '@/lib/error-message';
import { cn } from '@/lib/cn';
import { useModal } from '@/lib/stores/modal-store';
import { FormField } from '@/components/auth/form-field';
import { SettingRow, SettingsSection } from '../primitives';
import { ChangePasswordDialog } from '../change-password-dialog';

// Editable subset of the profile for this tab. The avatar is handled separately
// by the avatar-upload modal, so it is deliberately NOT part of this form.
const accountFormSchema = updateProfileSchema.pick({
  nickname: true,
  status: true,
});
type AccountFormValues = z.infer<typeof accountFormSchema>;

function AccountSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <Skeleton className="h-20 w-20 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-full" />
        </div>
      </div>
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

export function AccountTab() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const fieldError = useFieldError();
  const errorMessage = useErrorMessage();
  const { user } = useAuth();
  const { open } = useModal();
  const { data: profile, isLoading, isError, error, refetch } = useProfileMe();
  const update = useUpdateProfile();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    values: profile
      ? {
          nickname: profile.nickname,
          status: profile.status ?? '',
        }
      : undefined,
  });

  const nickname = watch('nickname');

  useEffect(() => {
    if (profile) {
      reset({
        nickname: profile.nickname,
        status: profile.status ?? '',
      });
    }
  }, [profile, reset]);

  const onSubmit = handleSubmit((values) => {
    // Send the status EXPLICITLY (an empty string is the intent to CLEAR it).
    // Coercing "" → undefined here drops the field from the PATCH, so clearing a
    // status silently no-ops and the old value sticks. `?? ''` keeps an empty
    // edit as a real "" the server persists as "no status".
    const payload: UpdateProfileDto = {
      nickname: values.nickname,
      status: values.status ?? '',
    };
    update.mutate(payload, {
      onSuccess: () => toast.success(t('account.profile.saved')),
      // Localized description (network/server) instead of the raw error string.
      onError: (e) => toast.error(t('account.profile.saveError'), { description: errorMessage(e) }),
    });
  });

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t('account.profile.title')}
        description={t('account.profile.description')}
        icon={<UserRound />}
        footer={
          profile && (
            <Button
              type="submit"
              form="account-form"
              variant="primary"
              disabled={!isDirty}
              loading={update.isPending}
            >
              {tc('save')}
            </Button>
          )
        }
      >
        {isLoading ? (
          <AccountSkeleton />
        ) : isError ? (
          <ErrorState
            // Show the friendly network message when the request never reached
            // the server; otherwise fall back to the load-specific copy. Never the
            // raw "Failed to fetch"/server string.
            message={error?.isNetworkError ? errorMessage(error) : undefined}
            fallback={t('account.profile.loadError')}
            retryLabel={tc('retry')}
            onRetry={() => refetch()}
          />
        ) : profile ? (
          <form id="account-form" onSubmit={onSubmit} noValidate className="space-y-5">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              {/* Avatar — click to open the shared upload modal (file upload). */}
              <button
                type="button"
                onClick={() => open('avatar-upload', { currentUrl: profile.avatarUrl })}
                aria-label={t('account.profile.avatarLabel')}
                className={cn(
                  'group relative shrink-0 rounded-full',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                )}
              >
                <Avatar
                  size="xl"
                  src={profile.avatarUrl}
                  alt={nickname || profile.nickname}
                  ring={profile.isPremium ? 'aurora' : 'none'}
                />
                <span
                  aria-hidden="true"
                  className="absolute inset-0 flex items-center justify-center rounded-full bg-background/55 opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100"
                >
                  <Camera className="h-5 w-5 text-foreground" />
                </span>
              </button>
              <div className="flex-1">
                <p className="font-display text-sm font-semibold">
                  {t('account.profile.avatarLabel')}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {t('account.profile.avatarHint')}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  leadingIcon={<Camera className="h-4 w-4" />}
                  onClick={() => open('avatar-upload', { currentUrl: profile.avatarUrl })}
                >
                  {t('account.profile.avatarChange')}
                </Button>
              </div>
            </div>

            <FormField
              label={t('account.profile.nicknameLabel')}
              required
              error={fieldError(errors.nickname?.message)}
            >
              {(field) => (
                <Input {...field} leadingIcon={<UserRound />} {...register('nickname')} />
              )}
            </FormField>

            <FormField
              label={t('account.profile.statusLabel')}
              error={errors.status?.message}
              hint={t('account.profile.statusHint')}
            >
              {(field) => (
                <Input
                  {...field}
                  placeholder={t('account.profile.statusPlaceholder')}
                  maxLength={140}
                  leadingIcon={<Quote />}
                  {...register('status')}
                />
              )}
            </FormField>
          </form>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title={t('account.credentials.title')}
        description={t('account.credentials.description')}
        icon={<AtSign />}
      >
        <div className="divide-y divide-border/50">
          <SettingRow
            label={t('account.credentials.emailLabel')}
            description={t('account.credentials.emailDescription')}
            control={
              user ? (
                <span className="text-sm text-muted-foreground">{user.email}</span>
              ) : (
                <Skeleton className="h-4 w-40" />
              )
            }
          />
          <SettingRow
            label={t('account.credentials.passwordLabel')}
            description={t('account.credentials.passwordDescription')}
            control={
              <ChangePasswordDialog
                trigger={
                  <Button
                    variant="secondary"
                    size="sm"
                    leadingIcon={<KeyRound className="h-4 w-4" />}
                  >
                    {t('account.credentials.changePassword')}
                  </Button>
                }
              />
            }
          />
        </div>
      </SettingsSection>
    </div>
  );
}

function ErrorState({
  message,
  fallback,
  retryLabel,
  onRetry,
}: {
  message?: string;
  fallback: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="text-sm text-muted-foreground">{message ?? fallback}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}
