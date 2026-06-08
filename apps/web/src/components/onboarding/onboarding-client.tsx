'use client';

/**
 * Post-registration onboarding — a guided, multi-step flow that helps a new user
 * complete their profile. Steps:
 *   0. Welcome
 *   1. Avatar — upload an image FILE via the shared avatar-upload modal
 *      (POST /profiles/me/avatar); persisted immediately, not part of the finish PATCH
 *   2. Identity — gender + birth date (hard 18+ gate, mirrors the API rule)
 *   3. Country
 *   4. Languages
 *   5. Interests (collected client-side; see note re: missing backend field)
 *
 * On finish we PATCH /profiles/me with the supported contract fields
 * (gender, birthDate, country, languages) via the existing `useUpdateProfile`
 * mutation, then route to the home feed. The avatar is uploaded separately by
 * the modal, so it is NOT included in this DTO.
 *
 * Data is wired against the existing api client + shared-types. Loading/empty/
 * error states are handled; the whole flow is keyboard-navigable and responsive.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Camera,
  Check,
  Mars,
  Sparkles,
  Transgender,
  Venus,
} from 'lucide-react';
import type { CountryCode, Gender, Locale, UpdateProfileDto } from '@ruletka/shared-types';
import { Avatar, Button, CountrySelect, Input, Label, Spinner, toast } from '@ruletka/ui';
import { ROUTES } from '@/config/nav';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useModal } from '@/lib/stores/modal-store';
import { useAuth, MIN_AGE, ageFromBirthDate } from '@/features/auth';
import { useProfile, useUpdateProfile } from '@/features/profile/use-profile';
import { SignInRequired } from '@/components/social/state-views';
import { ProfileSkeleton } from '@/components/profile/profile-skeleton';
import { OnboardingStepper, type StepperStep } from './onboarding-stepper';
import { StepHeading, SelectChip, OptionCard } from './onboarding-ui';
import { INTERESTS } from './interests';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

const STEPS: StepperStep[] = [
  { key: 'welcome', labelKey: 'onboarding.stepWelcome' },
  { key: 'avatar', labelKey: 'onboarding.stepAvatar' },
  { key: 'identity', labelKey: 'onboarding.stepIdentity' },
  { key: 'country', labelKey: 'onboarding.stepCountry' },
  { key: 'languages', labelKey: 'onboarding.stepLanguages' },
  { key: 'interests', labelKey: 'onboarding.stepInterests' },
];

const GENDERS: { value: Gender; labelKey: string; icon: React.ReactNode }[] = [
  { value: 'female', labelKey: 'onboarding.genderFemale', icon: <Venus className="h-5 w-5" /> },
  { value: 'male', labelKey: 'onboarding.genderMale', icon: <Mars className="h-5 w-5" /> },
  { value: 'other', labelKey: 'onboarding.genderOther', icon: <Transgender className="h-5 w-5" /> },
];

// Language self-names are intentionally shown in their own language, so they
// stay as literals rather than going through the message catalogue.
const LOCALES: { value: Locale; label: string }[] = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
];

interface OnboardingState {
  gender: Gender | null;
  birthDate: string;
  country: CountryCode | null;
  languages: Locale[];
  interests: string[];
}

export function OnboardingClient() {
  const t = useTranslations('misc');
  const router = useRouter();
  const { open } = useModal();
  const { user, isAuthenticated, isReady } = useAuth();
  const profileQuery = useProfile(user?.id);
  const updateProfile = useUpdateProfile();

  const [step, setStep] = useState(0);
  // Direction drives the slide animation (1 = forward, -1 = back).
  const [dir, setDir] = useState(1);
  const [state, setState] = useState<OnboardingState>({
    gender: null,
    birthDate: '',
    country: null,
    languages: ['ru'],
    interests: [],
  });
  const hydratedRef = useRef(false);

  // Prefill once from the loaded profile (so returning users see their data).
  // The avatar is read live from `profile` for the preview (the upload modal
  // refreshes that cache), so it is intentionally not mirrored into local state.
  const profile = profileQuery.data;
  useEffect(() => {
    if (!profile || hydratedRef.current) return;
    hydratedRef.current = true;
    setState((s) => ({
      ...s,
      gender: profile.gender ?? null,
      country: profile.country ?? null,
      languages: profile.languages?.length ? profile.languages : s.languages,
    }));
  }, [profile]);

  const age = state.birthDate ? ageFromBirthDate(state.birthDate) : NaN;
  const ageValid = !Number.isNaN(age) && age >= MIN_AGE;
  const birthInFuture = state.birthDate ? new Date(state.birthDate).getTime() > Date.now() : false;

  // Per-step "can advance" gating.
  const canNext = useMemo(() => {
    switch (STEPS[step]?.key) {
      case 'identity':
        return Boolean(state.gender) && Boolean(state.birthDate) && ageValid && !birthInFuture;
      case 'country':
        return Boolean(state.country);
      case 'languages':
        return state.languages.length > 0;
      default:
        return true; // welcome / avatar / interests are optional
    }
  }, [step, state, ageValid, birthInFuture]);

  // Auth/loading gates.
  if (isReady && !isAuthenticated) {
    return <SignInRequired description={t('onboarding.signInDesc')} />;
  }
  if (!user || profileQuery.isLoading) return <ProfileSkeleton />;

  const isLast = step === STEPS.length - 1;
  // `step` is always clamped to a valid index; capture the key for the render.
  const currentKey = (STEPS[step] ?? STEPS[0]!).key;

  function go(next: number) {
    setDir(next > step ? 1 : -1);
    setStep(Math.max(0, Math.min(STEPS.length - 1, next)));
  }

  function buildDto(): UpdateProfileDto {
    const dto: UpdateProfileDto = {};
    // Avatar is uploaded separately (file upload via the modal), not patched here.
    if (state.gender) dto.gender = state.gender;
    if (state.birthDate) dto.birthDate = state.birthDate;
    if (state.country) dto.country = state.country;
    if (state.languages.length) dto.languages = state.languages;
    return dto;
  }

  function finish() {
    const dto = buildDto();
    if (Object.keys(dto).length === 0) {
      router.push(ROUTES.home);
      return;
    }
    updateProfile.mutate(dto, {
      onSuccess: () => {
        toast.success(t('onboarding.profileReady'));
        router.push(ROUTES.home);
      },
      onError: (err) => {
        const msg =
          err instanceof ApiClientError && Array.isArray(err.body?.message)
            ? err.body!.message.join(', ')
            : err instanceof ApiClientError && err.status === 409
              ? t('onboarding.nicknameTaken')
              : t('onboarding.saveError');
        toast.error(msg);
      },
    });
  }

  function skip() {
    router.push(ROUTES.home);
  }

  const displayName = user.nickname;

  return (
    <div className="grain relative min-h-[calc(100dvh-4rem)] overflow-hidden">
      {/* Atmospheric background. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--color-neon-violet)_0%,transparent_60%)] opacity-[0.18] blur-3xl" />
        <div className="absolute -right-24 top-32 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-magenta)_0%,transparent_60%)] opacity-[0.14] blur-3xl" />
        <div className="absolute -left-24 bottom-24 h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan)_0%,transparent_60%)] opacity-[0.12] blur-3xl" />
      </div>

      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-2xl flex-col px-4 py-10 sm:px-6 sm:py-14">
        {/* Header: skip + stepper */}
        <div className="mb-8 flex items-center justify-between gap-4">
          <span className="glass-panel inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
            {t('onboarding.badge')}
          </span>
          {!isLast && (
            <button
              type="button"
              onClick={skip}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('onboarding.skip')}
            </button>
          )}
        </div>

        <OnboardingStepper steps={STEPS} current={step} />

        {/* Step panel */}
        <div className="relative mt-10 flex-1">
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
              key={currentKey}
              custom={dir}
              initial={{ opacity: 0, x: dir * 28 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -28 }}
              transition={{ duration: 0.32, ease: EASE_OUT }}
              className="glass-panel rounded-3xl p-6 sm:p-8"
            >
              {currentKey === 'welcome' && (
                <div className="space-y-5 text-center">
                  <span className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--color-neon-violet)] to-[var(--color-neon-magenta)] text-primary-foreground shadow-[0_8px_30px_-8px_var(--color-neon-violet)]">
                    <Sparkles className="h-8 w-8" aria-hidden="true" />
                  </span>
                  <div>
                    <h2 className="font-display text-2xl font-extrabold tracking-tight">
                      {t('onboarding.welcomeTitle', { name: displayName })}
                    </h2>
                    <p className="mx-auto mt-2 max-w-md text-balance text-muted-foreground">
                      {t('onboarding.welcomeText')}
                    </p>
                  </div>
                </div>
              )}

              {currentKey === 'avatar' && (
                <div className="space-y-6">
                  <StepHeading
                    title={t('onboarding.avatarTitle')}
                    subtitle={t('onboarding.avatarSubtitle')}
                  />
                  <div className="flex flex-col items-center gap-4 sm:flex-row">
                    {/* Click the avatar (or the button) to upload an image file. */}
                    <button
                      type="button"
                      onClick={() => open('avatar-upload', { currentUrl: profile?.avatarUrl })}
                      aria-label={t('onboarding.avatarChange')}
                      className={cn(
                        'group relative shrink-0 rounded-full',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      )}
                    >
                      <Avatar
                        src={profile?.avatarUrl ?? null}
                        alt={displayName}
                        size="xl"
                        ring={profile?.avatarUrl ? 'aurora' : 'none'}
                      />
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 flex items-center justify-center rounded-full bg-background/55 opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100"
                      >
                        <Camera className="h-5 w-5 text-foreground" />
                      </span>
                    </button>
                    <div className="w-full flex-1">
                      <p className="font-display text-sm font-semibold">
                        {t('onboarding.avatarLabel')}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t('onboarding.avatarHint')}
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="mt-3"
                        leadingIcon={<Camera className="h-4 w-4" />}
                        onClick={() => open('avatar-upload', { currentUrl: profile?.avatarUrl })}
                      >
                        {t('onboarding.avatarChange')}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {currentKey === 'identity' && (
                <div className="space-y-6">
                  <StepHeading
                    title={t('onboarding.identityTitle')}
                    subtitle={t('onboarding.identitySubtitle')}
                  />
                  <div>
                    <Label>{t('onboarding.genderLabel')}</Label>
                    <div
                      className="mt-2 flex flex-col gap-3 sm:flex-row"
                      role="radiogroup"
                      aria-label={t('onboarding.genderLabel')}
                    >
                      {GENDERS.map((g) => (
                        <OptionCard
                          key={g.value}
                          selected={state.gender === g.value}
                          onClick={() => setState((s) => ({ ...s, gender: g.value }))}
                          icon={g.icon}
                          label={t(g.labelKey)}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="ob-birth">{t('onboarding.birthDateLabel')}</Label>
                    <Input
                      id="ob-birth"
                      type="date"
                      value={state.birthDate}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setState((s) => ({ ...s, birthDate: e.target.value }))}
                      leadingIcon={<CalendarDays className="h-4 w-4" />}
                      invalid={Boolean(state.birthDate) && (!ageValid || birthInFuture)}
                      className="mt-1.5"
                      aria-describedby="ob-birth-hint"
                    />
                    <p id="ob-birth-hint" className="mt-1.5 text-xs text-muted-foreground">
                      {state.birthDate && birthInFuture ? (
                        <span className="text-destructive">{t('onboarding.birthFuture')}</span>
                      ) : state.birthDate && !ageValid ? (
                        <span className="text-destructive">
                          {t('onboarding.ageTooYoung', { minAge: MIN_AGE })}
                        </span>
                      ) : (
                        <>{t('onboarding.ageAdultsOnly')}</>
                      )}
                    </p>
                  </div>
                </div>
              )}

              {currentKey === 'country' && (
                <div className="space-y-6">
                  <StepHeading
                    title={t('onboarding.countryTitle')}
                    subtitle={t('onboarding.countrySubtitle')}
                  />
                  <div>
                    <Label htmlFor="ob-country">{t('onboarding.countryLabel')}</Label>
                    <div className="mt-1.5">
                      <CountrySelect
                        id="ob-country"
                        aria-label={t('onboarding.countryLabel')}
                        maxSelections={1}
                        placeholder={t('onboarding.countryPlaceholder')}
                        value={state.country ? [state.country] : []}
                        onChange={(codes: CountryCode[]) =>
                          setState((s) => ({ ...s, country: codes[codes.length - 1] ?? null }))
                        }
                      />
                    </div>
                  </div>
                </div>
              )}

              {currentKey === 'languages' && (
                <div className="space-y-6">
                  <StepHeading
                    title={t('onboarding.languagesTitle')}
                    subtitle={t('onboarding.languagesSubtitle')}
                  />
                  <div className="flex flex-wrap gap-2.5">
                    {LOCALES.map((l) => {
                      const selected = state.languages.includes(l.value);
                      return (
                        <SelectChip
                          key={l.value}
                          selected={selected}
                          onClick={() =>
                            setState((s) => ({
                              ...s,
                              languages: selected
                                ? s.languages.filter((x) => x !== l.value)
                                : [...s.languages, l.value],
                            }))
                          }
                        >
                          {l.label}
                        </SelectChip>
                      );
                    })}
                  </div>
                  {state.languages.length === 0 && (
                    <p className="text-xs text-destructive">{t('onboarding.languagesEmpty')}</p>
                  )}
                </div>
              )}

              {currentKey === 'interests' && (
                <div className="space-y-6">
                  <StepHeading
                    title={t('onboarding.interestsTitle')}
                    subtitle={t('onboarding.interestsSubtitle')}
                  />
                  <div className="flex flex-wrap gap-2.5">
                    {INTERESTS.map((it) => {
                      const selected = state.interests.includes(it.key);
                      return (
                        <SelectChip
                          key={it.key}
                          selected={selected}
                          onClick={() =>
                            setState((s) => ({
                              ...s,
                              interests: selected
                                ? s.interests.filter((x) => x !== it.key)
                                : [...s.interests, it.key],
                            }))
                          }
                        >
                          <span aria-hidden="true">{it.emoji}</span>
                          {t(it.labelKey)}
                        </SelectChip>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer navigation */}
        <div className="mt-8 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => go(step - 1)}
            disabled={step === 0 || updateProfile.isPending}
            leadingIcon={<ArrowLeft className="h-4 w-4" />}
            className={cn(step === 0 && 'invisible')}
          >
            {t('onboarding.back')}
          </Button>

          {isLast ? (
            <Button
              type="button"
              size="lg"
              onClick={finish}
              loading={updateProfile.isPending}
              trailingIcon={!updateProfile.isPending ? <Check className="h-5 w-5" /> : undefined}
            >
              {t('onboarding.finish')}
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              onClick={() => go(step + 1)}
              disabled={!canNext}
              trailingIcon={<ArrowRight className="h-5 w-5" />}
            >
              {step === 0 ? t('onboarding.begin') : t('onboarding.next')}
            </Button>
          )}
        </div>
      </div>

      {/* Decorative loading veil while saving. */}
      {updateProfile.isPending && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="glass-panel flex items-center gap-3 rounded-full px-5 py-3">
            <Spinner size="sm" role="presentation" label="" />
            <span className="text-sm text-muted-foreground">{t('onboarding.saving')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
