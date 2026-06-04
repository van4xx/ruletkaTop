'use client';

/**
 * Account tab — avatar + nickname + status edits (PATCH /profile/me), the
 * read-only account email (from the auth user), and a change-password dialog.
 *
 * The profile form uses react-hook-form + the contract `updateProfileSchema`
 * (picked down to the editable fields). Email is immutable here. Loading,
 * error and saving states are all covered.
 */
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { AtSign, ImageIcon, KeyRound, Quote, UserRound } from 'lucide-react';
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
import { FormField } from '@/components/auth/form-field';
import { SettingRow, SettingsSection } from '../primitives';
import { ChangePasswordDialog } from '../change-password-dialog';

// Editable subset of the profile for this tab.
const accountFormSchema = updateProfileSchema.pick({
  nickname: true,
  status: true,
  avatarUrl: true,
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
          avatarUrl: profile.avatarUrl ?? '',
        }
      : undefined,
  });

  // Keep avatar preview in sync with the (optional) URL field.
  const avatarUrl = watch('avatarUrl');
  const nickname = watch('nickname');

  useEffect(() => {
    if (profile) {
      reset({
        nickname: profile.nickname,
        status: profile.status ?? '',
        avatarUrl: profile.avatarUrl ?? '',
      });
    }
  }, [profile, reset]);

  const onSubmit = handleSubmit((values) => {
    // Drop empty optional strings so we don't send "" for unset fields.
    const payload: UpdateProfileDto = {
      nickname: values.nickname,
      status: values.status ? values.status : undefined,
      avatarUrl: values.avatarUrl ? values.avatarUrl : undefined,
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
              <Avatar
                size="xl"
                src={avatarUrl || profile.avatarUrl}
                alt={nickname || profile.nickname}
                ring={profile.isPremium ? 'aurora' : 'none'}
              />
              <div className="w-full flex-1">
                <FormField
                  label={t('account.profile.avatarLabel')}
                  error={errors.avatarUrl?.message}
                  hint={t('account.profile.avatarHint')}
                >
                  {(field) => (
                    <Input
                      {...field}
                      type="url"
                      inputMode="url"
                      placeholder={t('account.profile.avatarPlaceholder')}
                      leadingIcon={<ImageIcon />}
                      {...register('avatarUrl')}
                    />
                  )}
                </FormField>
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
