'use client';

/**
 * "Reset password" form — reached from the emailed link (`/reset-password?token=…`).
 *
 * Reads the single-use `token` from the URL, collects a new password (validated
 * against the shared strength policy + shown with the register strength meter),
 * and POSTs `{ token, password }` to `/auth/reset-password` via `useResetPassword`.
 * On success it redirects to `/login` with a toast; the API rejects expired or
 * already-used tokens, which we surface as a friendly "link expired" state with
 * a path back to request a fresh one.
 *
 * Mechanics mirror the login/register forms (react-hook-form + zod, a top-level
 * error banner, a loading submit button). Hard-navigates on success so the
 * fresh `/login` request starts from a clean state.
 */
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { CircleAlert, TriangleAlert } from 'lucide-react';
import { Button, toast } from '@ruletka/ui';
import { resetPasswordFormSchema, type ResetPasswordFormValues } from '@/features/auth/schemas';
import { useResetPassword } from '@/features/auth/use-auth-email';
import { FormField } from './form-field';
import { PasswordField } from './password-field';

export function ResetPasswordForm() {
  const t = useTranslations('auth');
  const params = useSearchParams();
  const token = params.get('token')?.trim() ?? '';
  const resetPassword = useResetPassword();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: { password: '' },
    mode: 'onTouched',
  });

  const passwordValue = watch('password');

  const onSubmit = handleSubmit((values) => {
    // Merge the URL token (the credential) back into the contract payload.
    resetPassword.mutate(
      { token, password: values.password },
      {
        onSuccess: () => {
          toast.success(t('resetPassword.successToast'), { description: t('resetPassword.successToastDescription') });
          // Hard navigation so /login boots cleanly (and re-runs its auth check).
          window.location.assign('/login');
        },
      },
    );
  });

  // A missing/blank token means the link was mangled or visited directly.
  if (!token) {
    return (
      <div>
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-warning/40 bg-warning/10">
          <TriangleAlert className="h-6 w-6 text-warning" aria-hidden="true" />
        </span>
        <h1 className="mt-6 font-display text-3xl font-bold tracking-tight">{t('resetPassword.missingToken.title')}</h1>
        <p className="mt-3 text-muted-foreground">
          {t('resetPassword.missingToken.body')}
        </p>
        <div className="mt-8">
          <Button asChild variant="primary" size="lg" block>
            <Link href="/forgot-password">{t('resetPassword.missingToken.requestNew')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  // The token was present but the server rejected it (expired / already used).
  const expired = resetPassword.isError && resetPassword.error?.status === 400;
  if (expired) {
    return (
      <div>
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-warning/40 bg-warning/10">
          <TriangleAlert className="h-6 w-6 text-warning" aria-hidden="true" />
        </span>
        <h1 className="mt-6 font-display text-3xl font-bold tracking-tight">{t('resetPassword.expired.title')}</h1>
        <p className="mt-3 text-muted-foreground">
          {t('resetPassword.expired.body')}
        </p>
        <div className="mt-8">
          <Button asChild variant="primary" size="lg" block>
            <Link href="/forgot-password">{t('resetPassword.expired.requestNew')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const busy = isSubmitting || resetPassword.isPending;

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold tracking-tight">{t('resetPassword.title')}</h1>
        <p className="mt-2 text-muted-foreground">
          {t('resetPassword.subtitle')}
        </p>
      </header>

      <AnimatePresence>
        {resetPassword.isError && !expired && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 20 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            role="alert"
            className="flex items-start gap-2.5 overflow-hidden rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-sm text-destructive"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{resetPassword.error?.message ?? t('resetPassword.genericError')}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <FormField label={t('resetPassword.newPassword')} required error={errors.password?.message} hint={t('resetPassword.passwordHint')}>
          {(field) => (
            <PasswordField
              {...field}
              autoComplete="new-password"
              placeholder={t('resetPassword.passwordPlaceholder')}
              autoFocus
              showStrength
              value={passwordValue}
              {...register('password')}
            />
          )}
        </FormField>

        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          {t('resetPassword.submit')}
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        <Link
          href="/login"
          className="font-semibold text-foreground underline-offset-4 transition-colors hover:text-[var(--color-neon-cyan)] hover:underline"
        >
          {t('resetPassword.backToLogin')}
        </Link>
      </p>
    </div>
  );
}
