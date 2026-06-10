'use client';

/**
 * Registration form — react-hook-form + zod (`registerFormSchema`, which adds
 * the client-side 18+ gate on top of the contract `registerSchema`). Fields:
 * email, password (+ strength meter), nickname, gender (segmented radiogroup),
 * birth date (native date input, 18+) and interface locale. Country is no longer
 * collected here — it's optional end-to-end and defaults to `null`.
 *
 * On success it persists the session and redirects home. Controlled fields
 * (gender / password meter / locale) use RHF `Controller`/`watch`.
 */
import { useState } from 'react';
import Link from 'next/link';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { AtSign, CircleAlert, Lock, UserRound } from 'lucide-react';
import { Button, Input, toast } from '@ruletka/ui';
import { track } from '@/lib/analytics';
import { usePublicStatus } from '@/features/status/use-public-status';
import {
  GENDER_OPTIONS,
  LOCALE_OPTIONS,
  MIN_AGE,
  registerFormSchema,
  type RegisterFormValues,
} from '@/features/auth/schemas';
import { useFieldError } from '@/features/auth/use-field-error';
import { useRegister } from '@/features/auth/use-auth-mutations';
import { useErrorMessage } from '@/lib/error-message';
import { FormField } from './form-field';
import { PasswordField } from './password-field';
import { SegmentedControl } from './segmented-control';
import { TurnstileWidget, TURNSTILE_SITE_KEY } from './turnstile-widget';

/** Latest yyyy-mm-dd a registrant could be born on to be exactly MIN_AGE. */
function maxBirthDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - MIN_AGE);
  return d.toISOString().slice(0, 10);
}

export function RegisterForm() {
  const t = useTranslations('auth');
  const fieldError = useFieldError();
  const errorMessage = useErrorMessage();
  const registerMutation = useRegister();

  // Live, admin-toggleable flag (public — works signed-out). When registration
  // is closed we show an inline notice and pre-disable submit; the API still
  // 403s the POST, this just makes the closed state user-friendly up front. We
  // only treat an EXPLICIT `false` as closed — undefined (loading / fetch
  // failed) leaves the form open so a status hiccup never blocks signups.
  const { data: publicStatus } = usePublicStatus();
  const registrationClosed = publicStatus?.registrationOpen === false;

  // Localized option labels for the segmented controls (the option arrays carry
  // stable `labelKey`s; resolve them here against the `auth` namespace).
  const genderOptions = GENDER_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }));
  const localeOptions = LOCALE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }));

  // CAPTCHA token (Cloudflare Turnstile). Held outside RHF since it's not a
  // user-typed field — it's injected into the submit payload. When no site key
  // is configured the widget renders nothing and this stays null (dev no-op).
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRequired = Boolean(TURNSTILE_SITE_KEY);

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      email: '',
      password: '',
      nickname: '',
      gender: 'female',
      birthDate: '',
      locale: 'ru',
      acceptedTerms: false,
      acceptedAdult: false,
    },
    mode: 'onTouched',
  });

  const passwordValue = watch('password');
  const termsAccepted = watch('acceptedTerms');
  const adultAccepted = watch('acceptedAdult');

  const onSubmit = handleSubmit((values) => {
    // Attach the Turnstile token when present; omit the key entirely otherwise
    // so the optional contract field stays absent (dev no-op).
    const payload = captchaToken ? { ...values, captchaToken } : values;
    registerMutation.mutate(payload, {
      onSuccess: () => {
        toast.success(t('register.successToast'), {
          description: t('register.successToastDescription'),
        });
        track('signup');
        // Hard navigation so the just-set auth cookies ride the next request.
        window.location.assign('/dashboard');
      },
    });
  });

  // 409 = email/nickname already taken (the expected rejection). Everything else
  // (network outage, 5xx, unexpected 4xx) routes through the localized helper so
  // we never surface a raw "Failed to fetch" or an untranslated server string.
  const apiMessage =
    registerMutation.error?.status === 409
      ? t('register.conflict')
      : errorMessage(registerMutation.error);

  const busy = isSubmitting || registerMutation.isPending;
  // Block submission until the CAPTCHA is solved (only when configured, else the
  // gate would deadlock the dev/no-key flow) AND the consent box is ticked (the
  // API rejects a registration without `acceptedTerms: true`). Also hard-block
  // while registration is closed (the API 403s anyway — this fails fast).
  const submitDisabled =
    busy ||
    registrationClosed ||
    (captchaRequired && !captchaToken) ||
    !termsAccepted ||
    !adultAccepted;

  return (
    <div>
      <header className="mb-7">
        <h1 className="font-display text-3xl font-bold tracking-tight">{t('register.title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('register.subtitle')}</p>
      </header>

      {/* Registration temporarily closed (live admin flag). Prominent inline
          notice; submit is also disabled below so the form fails fast before the
          backend 403. */}
      <AnimatePresence>
        {registrationClosed && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 20 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            role="status"
            aria-live="polite"
            className="flex items-start gap-2.5 overflow-hidden rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3.5 py-3 text-sm text-foreground/90"
          >
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
            <span>
              <span className="font-semibold">{t('register.closed.title')}</span>{' '}
              <span className="text-muted-foreground">{t('register.closed.body')}</span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {registerMutation.isError && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 20 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            role="alert"
            className="flex items-start gap-2.5 overflow-hidden rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-sm text-destructive"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{apiMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <FormField label={t('fields.email')} required error={fieldError(errors.email?.message)}>
          {(field) => (
            <Input
              {...field}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t('fields.emailPlaceholder')}
              leadingIcon={<AtSign />}
              {...register('email')}
            />
          )}
        </FormField>

        <FormField
          label={t('register.nickname')}
          required
          error={fieldError(errors.nickname?.message)}
          hint={t('register.nicknameHint')}
        >
          {(field) => (
            <Input
              {...field}
              autoComplete="username"
              placeholder={t('register.nicknamePlaceholder')}
              leadingIcon={<UserRound />}
              {...register('nickname')}
            />
          )}
        </FormField>

        <FormField
          label={t('fields.password')}
          required
          error={fieldError(errors.password?.message)}
          hint={t('register.passwordHint')}
        >
          {(field) => (
            <PasswordField
              {...field}
              autoComplete="new-password"
              placeholder={t('register.passwordPlaceholder')}
              showStrength
              value={passwordValue}
              {...register('password')}
            />
          )}
        </FormField>

        {/* Gender — accessible segmented radiogroup. */}
        <FormField label={t('register.gender')} required error={fieldError(errors.gender?.message)}>
          {(field) => (
            <Controller
              control={control}
              name="gender"
              render={({ field: { value, onChange } }) => (
                <SegmentedControl
                  id={field.id}
                  aria-label={t('register.gender')}
                  options={genderOptions}
                  value={value}
                  onChange={onChange}
                />
              )}
            />
          )}
        </FormField>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            label={t('register.birthDate')}
            required
            error={fieldError(errors.birthDate?.message)}
          >
            {(field) => (
              <Input
                {...field}
                type="date"
                autoComplete="bday"
                max={maxBirthDate()}
                {...register('birthDate')}
              />
            )}
          </FormField>

          <FormField label={t('register.locale')} error={fieldError(errors.locale?.message)}>
            {(field) => (
              <Controller
                control={control}
                name="locale"
                render={({ field: { value, onChange } }) => (
                  <SegmentedControl
                    id={field.id}
                    aria-label={t('register.locale')}
                    options={localeOptions}
                    value={value ?? 'ru'}
                    onChange={onChange}
                  />
                )}
              />
            )}
          </FormField>
        </div>

        {/* Anti-abuse CAPTCHA. Renders nothing when no site key is configured. */}
        <TurnstileWidget onToken={setCaptchaToken} className="flex justify-center" />

        {/* Explicit consent (152-ФЗ / GDPR) — the API requires acceptedTerms===true. */}
        <Controller
          control={control}
          name="acceptedTerms"
          render={({ field: { value, onChange } }) => (
            <div>
              <label className="flex cursor-pointer select-none items-start gap-2.5 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={value ?? false}
                  onChange={(e) => onChange(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-[var(--color-neon-cyan)]"
                />
                <span>
                  {t.rich('register.acceptTerms', {
                    terms: (chunks) => (
                      <Link
                        href="/rules"
                        target="_blank"
                        className="font-medium text-foreground underline-offset-4 transition-colors hover:text-[var(--color-neon-cyan)] hover:underline"
                      >
                        {chunks}
                      </Link>
                    ),
                    privacy: (chunks) => (
                      <Link
                        href="/privacy"
                        target="_blank"
                        className="font-medium text-foreground underline-offset-4 transition-colors hover:text-[var(--color-neon-cyan)] hover:underline"
                      >
                        {chunks}
                      </Link>
                    ),
                  })}
                </span>
              </label>
              {errors.acceptedTerms && (
                <p className="mt-1.5 text-xs text-destructive">
                  {fieldError(errors.acceptedTerms.message)}
                </p>
              )}
            </div>
          )}
        />

        {/* AGE-GATE LEVEL 1 — explicit 18+ self-attestation, captured as a
            SEPARATE consent record (audited as `user.consent.adult` server-side).
            The API rejects a registration unless `acceptedAdult === true`, EVEN
            IF the self-attested birthDate is already >= 18. */}
        <Controller
          control={control}
          name="acceptedAdult"
          render={({ field: { value, onChange } }) => (
            <div>
              <label className="flex cursor-pointer select-none items-start gap-2.5 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={value ?? false}
                  onChange={(e) => onChange(e.target.checked)}
                  aria-required="true"
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-[var(--color-neon-cyan)]"
                />
                <span>{t('register.adult.label')}</span>
              </label>
              {errors.acceptedAdult && (
                <p className="mt-1.5 text-xs text-destructive">
                  {fieldError(errors.acceptedAdult.message)}
                </p>
              )}
            </div>
          )}
        />

        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          loading={busy}
          disabled={submitDisabled}
          className="mt-1"
        >
          {t('register.submit')}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          {t('register.ageConfirm', { minAge: MIN_AGE })}
        </p>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t('register.haveAccount')}{' '}
        <Link
          href="/login"
          className="font-semibold text-foreground underline-offset-4 transition-colors hover:text-[var(--color-neon-cyan)] hover:underline"
        >
          {t('register.signIn')}
        </Link>
      </p>
    </div>
  );
}
