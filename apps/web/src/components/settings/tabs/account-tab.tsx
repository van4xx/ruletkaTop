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
import { AtSign, ImageIcon, KeyRound, Quote, UserRound } from 'lucide-react';
import {
  updateProfileSchema,
  type PublicProfile,
  type UpdateProfileDto,
} from '@ruletka/shared-types';
import { Avatar, Button, Input, Skeleton, toast } from '@ruletka/ui';
import { useAuth } from '@/features/auth/use-auth';
import { useProfileMe, useUpdateProfile } from '@/features/settings/use-settings';
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
      onSuccess: () => toast.success('Профиль обновлён'),
      onError: (e) => toast.error('Не удалось сохранить', { description: e.message }),
    });
  });

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Профиль"
        description="Так тебя видят другие пользователи."
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
              Сохранить
            </Button>
          )
        }
      >
        {isLoading ? (
          <AccountSkeleton />
        ) : isError ? (
          <ErrorState message={error?.message} onRetry={() => refetch()} />
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
                  label="Ссылка на аватар"
                  error={errors.avatarUrl?.message}
                  hint="Прямая ссылка на изображение (https://…)"
                >
                  {(field) => (
                    <Input
                      {...field}
                      type="url"
                      inputMode="url"
                      placeholder="https://…/avatar.jpg"
                      leadingIcon={<ImageIcon />}
                      {...register('avatarUrl')}
                    />
                  )}
                </FormField>
              </div>
            </div>

            <FormField label="Никнейм" required error={errors.nickname?.message}>
              {(field) => (
                <Input {...field} leadingIcon={<UserRound />} {...register('nickname')} />
              )}
            </FormField>

            <FormField label="Статус" error={errors.status?.message} hint="До 140 символов">
              {(field) => (
                <Input
                  {...field}
                  placeholder="Расскажи о себе одной строкой"
                  maxLength={140}
                  leadingIcon={<Quote />}
                  {...register('status')}
                />
              )}
            </FormField>
          </form>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Учётная запись" description="Данные для входа." icon={<AtSign />}>
        <div className="divide-y divide-border/50">
          <SettingRow
            label="Email"
            description="Используется для входа. Обратись в поддержку, чтобы изменить."
            control={
              user ? (
                <span className="text-sm text-muted-foreground">{user.email}</span>
              ) : (
                <Skeleton className="h-4 w-40" />
              )
            }
          />
          <SettingRow
            label="Пароль"
            description="Рекомендуем менять пароль время от времени."
            control={
              <ChangePasswordDialog
                trigger={
                  <Button variant="secondary" size="sm" leadingIcon={<KeyRound className="h-4 w-4" />}>
                    Сменить пароль
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

function ErrorState({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="text-sm text-muted-foreground">{message ?? 'Не удалось загрузить профиль.'}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Повторить
      </Button>
    </div>
  );
}
