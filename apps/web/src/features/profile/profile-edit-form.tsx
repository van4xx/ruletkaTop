'use client';

/**
 * Own-profile edit form. Validates with the shared `updateProfileSchema`
 * (react-hook-form + zod resolver) and PATCHes `/profiles/me`. Only changed
 * fields are sent (the schema is partial). Editable: nickname, status, gender,
 * country, languages. The avatar is changed through the shared avatar-upload
 * modal (consistent with the rest of the app) and stays in sync via the
 * economy "me" cache.
 */
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Camera } from 'lucide-react';
import {
  updateProfileSchema,
  type UpdateProfileDto,
  type CountryCode,
  type Gender,
  type Locale,
  type PublicProfile,
} from '@ruletka/shared-types';
import {
  Avatar,
  Button,
  CountrySelect,
  Input,
  Label,
  Textarea,
  toast,
} from '@ruletka/ui';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useModal } from '@/lib/stores/modal-store';
import { useUpdateProfile } from './use-profile';
import { InterestsEditor } from './interests-editor';

const GENDERS: Gender[] = ['male', 'female', 'other'];

// Language self-names are intentionally shown in their own language, so they
// stay as literals rather than going through the message catalogue.
const LOCALES: { value: Locale; label: string }[] = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
];

type FormValues = UpdateProfileDto;

export function ProfileEditForm({
  profile,
  onDone,
}: {
  profile: PublicProfile;
  onDone?: () => void;
}) {
  const t = useTranslations('profile');
  const updateProfile = useUpdateProfile();
  const { open } = useModal();

  const {
    control,
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      nickname: profile.nickname,
      status: profile.status ?? '',
      gender: profile.gender,
      country: profile.country,
      languages: profile.languages,
      interests: profile.interests ?? [],
    },
  });

  const nickname = watch('nickname');

  function onSubmit(values: FormValues) {
    // Send only fields that differ from the loaded profile to keep PATCH minimal.
    // The avatar is handled separately by the avatar-upload modal.
    const dto: UpdateProfileDto = {};
    if (values.nickname !== profile.nickname) dto.nickname = values.nickname;
    if ((values.status ?? '') !== (profile.status ?? '')) dto.status = values.status;
    if (values.gender !== profile.gender) dto.gender = values.gender;
    if (values.country !== profile.country) dto.country = values.country;
    if (JSON.stringify(values.languages ?? []) !== JSON.stringify(profile.languages))
      dto.languages = values.languages;
    if (JSON.stringify(values.interests ?? []) !== JSON.stringify(profile.interests ?? []))
      dto.interests = values.interests ?? [];

    if (Object.keys(dto).length === 0) {
      toast.info(t('editForm.noChanges'));
      onDone?.();
      return;
    }

    updateProfile.mutate(dto, {
      onSuccess: (updated) => {
        toast.success(t('editForm.saved'));
        reset({
          nickname: updated.nickname,
          status: updated.status ?? '',
          gender: updated.gender,
          country: updated.country,
          languages: updated.languages,
          interests: updated.interests ?? [],
        });
        onDone?.();
      },
      onError: (err) => {
        const msg =
          err instanceof ApiClientError && err.status === 409
            ? t('editForm.nicknameTaken')
            : err instanceof ApiClientError && Array.isArray(err.body?.message)
              ? err.body!.message.join(', ')
              : t('editForm.saveError');
        toast.error(msg);
      },
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Avatar — opens the shared avatar-upload modal */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => open('avatar-upload', { currentUrl: profile.avatarUrl })}
          aria-label={t('editForm.changeAvatarAria')}
          className={cn(
            'group relative rounded-full',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          )}
        >
          <Avatar
            src={profile.avatarUrl}
            alt={nickname || profile.nickname}
            size="xl"
            ring={profile.isPremium ? 'aurora' : 'none'}
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center rounded-full bg-background/55 opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100"
          >
            <Camera className="h-5 w-5 text-foreground" />
          </span>
        </button>
        <div>
          <p className="font-display text-sm font-bold">{t('editForm.photoTitle')}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('editForm.photoHint')}</p>
        </div>
      </div>

      {/* Nickname */}
      <div>
        <Label htmlFor="nickname">{t('editForm.nicknameLabel')}</Label>
        <Input
          id="nickname"
          invalid={Boolean(errors.nickname)}
          className="mt-1.5"
          autoComplete="off"
          {...register('nickname')}
        />
        {errors.nickname && <FieldError>{t('editForm.nicknameError')}</FieldError>}
      </div>

      {/* Status */}
      <div>
        <Label htmlFor="status">{t('editForm.statusLabel')}</Label>
        <Textarea
          id="status"
          rows={2}
          placeholder={t('editForm.statusPlaceholder')}
          invalid={Boolean(errors.status)}
          className="mt-1.5"
          {...register('status')}
        />
        {errors.status && <FieldError>{t('editForm.statusError')}</FieldError>}
      </div>

      {/* Gender */}
      <div>
        <Label>{t('editForm.genderLabel')}</Label>
        <Controller
          control={control}
          name="gender"
          render={({ field }) => (
            <div
              className="mt-1.5 flex flex-wrap gap-2"
              role="radiogroup"
              aria-label={t('editForm.genderLabel')}
            >
              {GENDERS.map((g) => (
                <button
                  key={g}
                  type="button"
                  role="radio"
                  aria-checked={field.value === g}
                  onClick={() => field.onChange(g)}
                  className={cn(
                    'rounded-full px-4 py-2 text-sm font-medium ring-1 transition-colors',
                    field.value === g
                      ? 'bg-[var(--color-neon-violet)]/15 text-foreground ring-[var(--color-neon-violet)]/50'
                      : 'bg-card/50 text-foreground/90 ring-border/60 hover:ring-border',
                  )}
                >
                  {t(`gender.${g}`)}
                </button>
              ))}
            </div>
          )}
        />
      </div>

      {/* Country */}
      <div>
        <Label htmlFor="country">{t('editForm.countryLabel')}</Label>
        <Controller
          control={control}
          name="country"
          render={({ field }) => (
            <div className="mt-1.5">
              <CountrySelect
                id="country"
                aria-label={t('editForm.countryLabel')}
                maxSelections={1}
                placeholder={t('editForm.countryPlaceholder')}
                value={field.value ? [field.value] : []}
                onChange={(codes: CountryCode[]) => field.onChange(codes[codes.length - 1])}
              />
            </div>
          )}
        />
        {errors.country && <FieldError>{t('editForm.countryError')}</FieldError>}
      </div>

      {/* Languages */}
      <div>
        <Label>{t('editForm.languagesLabel')}</Label>
        <Controller
          control={control}
          name="languages"
          render={({ field }) => {
            const selected = field.value ?? [];
            const toggle = (loc: Locale) =>
              field.onChange(
                selected.includes(loc) ? selected.filter((l) => l !== loc) : [...selected, loc],
              );
            return (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {LOCALES.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    aria-pressed={selected.includes(l.value)}
                    onClick={() => toggle(l.value)}
                    className={cn(
                      'rounded-full px-4 py-2 text-sm font-medium ring-1 transition-colors',
                      selected.includes(l.value)
                        ? 'bg-[var(--color-neon-cyan)]/15 text-foreground ring-[var(--color-neon-cyan)]/50'
                        : 'bg-card/50 text-foreground/90 ring-border/60 hover:ring-border',
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            );
          }}
        />
        {errors.languages && <FieldError>{t('editForm.languagesError')}</FieldError>}
      </div>

      {/* Interests */}
      <div>
        <Controller
          control={control}
          name="interests"
          render={({ field }) => (
            <InterestsEditor value={field.value ?? []} onChange={field.onChange} />
          )}
        />
        {errors.interests && <FieldError>{t('editForm.interestsError')}</FieldError>}
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-border/60 pt-4">
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            {t('editForm.cancel')}
          </Button>
        )}
        <Button type="submit" variant="primary" loading={updateProfile.isPending} disabled={!isDirty}>
          {t('editForm.save')}
        </Button>
      </div>
    </form>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-sm text-destructive">{children}</p>;
}
