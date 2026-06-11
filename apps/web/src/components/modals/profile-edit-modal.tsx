'use client';

/**
 * Profile editor as a modal.
 *
 * Ports the full edit form (nickname, status/bio, gender, country, languages,
 * interests, plus the avatar/cover entry points) from /profile/me/edit into the
 * unified modal system. The standalone route remains as a deep-linkable
 * fallback — both surfaces share the same submit path:
 *
 *   PATCH /profiles/me → react-query invalidates `profileKeys.detail` + the
 *   `economy.me` and `auth.me` caches via {@link useUpdateProfile} → success
 *   toast → modal closes.
 *
 * UX
 *   • Desktop: `max-w-3xl` (set in modal-host) with a two-column layout
 *     (photo/cover on the left, identity fields on the right).
 *   • Mobile: single column inside the standard dialog sheet.
 *   • Save shows pending state; Cancel/close (overlay click, Esc, ✕) prompts a
 *     confirm when {@link useForm}'s `isDirty` is `true` — implemented by
 *     intercepting Radix's `onOpenChange` lifecycle (we set
 *     `dirtyDiscardLockedRef` so the user must explicitly confirm/discard).
 */
import { useEffect, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Camera, ImageIcon, Pencil } from 'lucide-react';
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Spinner,
  Textarea,
  toast,
} from '@ruletka/ui';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAuth } from '@/features/auth';
import { useModal, useModalStore } from '@/lib/stores/modal-store';
import { useProfile, useUpdateProfile } from '@/features/profile/use-profile';
import { InterestsEditor } from '@/features/profile/interests-editor';
import { FieldError } from './shared';

const GENDERS: Gender[] = ['male', 'female', 'other'];

// Language self-names are intentionally shown in their own language, so they
// stay as literals rather than going through the message catalogue.
const LOCALES: { value: Locale; label: string }[] = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
];

type FormValues = UpdateProfileDto;

/**
 * Outer wrapper: handles the load/auth states + the close-confirm guard. The
 * inner {@link ProfileEditForm} is only mounted once we have a profile so
 * `react-hook-form` can initialise from real defaults.
 */
export function ProfileEditModal() {
  const t = useTranslations('profile');
  const { close } = useModal();
  const { user, isReady, isAuthenticated } = useAuth();
  const profileQuery = useProfile(user?.id);

  // The form imperatively reports its `isDirty` via this ref so the outer
  // close-guard can read it without re-rendering on every keystroke.
  const isDirtyRef = useRef(false);

  // Intercept Radix's open lifecycle: when the user tries to close (overlay
  // click, Esc, ✕ button — all funnel through the host's onOpenChange → store
  // close), confirm if the form is dirty. We wrap the store's `close` for the
  // duration this modal is mounted so the host's path goes through us.
  useEffect(() => {
    const original = useModalStore.getState().close;
    useModalStore.setState({
      close: () => {
        if (isDirtyRef.current) {
          const confirmed =
            typeof window !== 'undefined' ? window.confirm(t('editModal.discardConfirm')) : true;
          if (!confirmed) return;
        }
        original();
      },
    });
    return () => {
      // Restore the original close — the next modal must not inherit our guard.
      useModalStore.setState({ close: original });
    };
  }, [t]);

  if (isReady && !isAuthenticated) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t('editModal.title')}</DialogTitle>
          <DialogDescription>{t('myProfileEdit.signInRequired')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            {t('editForm.cancel')}
          </Button>
        </DialogFooter>
      </>
    );
  }

  if (!user || profileQuery.isLoading || !profileQuery.data) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t('editModal.title')}</DialogTitle>
          <DialogDescription>{t('editModal.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid place-items-center py-12">
          <Spinner />
        </div>
      </>
    );
  }

  return (
    <ProfileEditForm
      profile={profileQuery.data}
      onClose={close}
      onDirtyChange={(d) => {
        isDirtyRef.current = d;
      }}
    />
  );
}

/**
 * The actual form body — a near-1:1 port of {@link import('@/features/profile/profile-edit-form').ProfileEditForm}
 * restyled into a modal layout (two columns on desktop) with a sticky-bottom
 * DialogFooter for actions.
 */
function ProfileEditForm({
  profile,
  onClose,
  onDirtyChange,
}: {
  profile: PublicProfile;
  onClose: () => void;
  onDirtyChange: (isDirty: boolean) => void;
}) {
  const t = useTranslations('profile');
  const updateProfile = useUpdateProfile();
  const { open } = useModal();
  const [submitting, setSubmitting] = useState(false);

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

  // Surface the dirty bit to the outer close-guard.
  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const nickname = watch('nickname');

  function onSubmit(values: FormValues) {
    // Send only fields that differ from the loaded profile to keep PATCH minimal.
    // The avatar/cover are handled separately by their dedicated modals.
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
      // Nothing changed → clear dirty + close without the discard guard tripping.
      onDirtyChange(false);
      onClose();
      return;
    }

    setSubmitting(true);
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
        onDirtyChange(false);
        onClose();
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
      onSettled: () => setSubmitting(false),
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-0">
      <DialogHeader>
        <DialogTitle>{t('editModal.title')}</DialogTitle>
        <DialogDescription>{t('editModal.description')}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-6 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        {/* ── Left column: photo + cover entry points ────────────────── */}
        <div className="space-y-4">
          {/* Avatar — opens the shared avatar-upload modal */}
          <div className="flex items-center gap-4 sm:flex-col sm:items-start sm:gap-3">
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

          {/* Cover picker entry point — kept here because the cover is a part
              of the visual identity, even though it has its own modal. */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leadingIcon={<ImageIcon className="h-4 w-4" />}
            onClick={() => open('cover-picker')}
            className="w-full"
          >
            {t('editModal.changeCover')}
          </Button>
        </div>

        {/* ── Right column: identity fields ──────────────────────────── */}
        <div className="space-y-5">
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

          {/* Status / bio */}
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
        </div>
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={submitting || updateProfile.isPending}
        >
          {t('editForm.cancel')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          leadingIcon={<Pencil className="h-4 w-4" />}
          loading={updateProfile.isPending || submitting}
          disabled={!isDirty}
        >
          {t('editForm.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
