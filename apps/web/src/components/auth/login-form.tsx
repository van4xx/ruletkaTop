'use client';

/**
 * Login form — react-hook-form + zod (`loginFormSchema` from the contract),
 * calling the api client via `useLogin`. On success it persists the session
 * and redirects to `?next=` (sanitised to same-origin paths) or home.
 *
 * States: per-field validation errors, a top-level error banner for the API
 * rejection (e.g. bad credentials), and a loading button.
 */
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { AtSign, CircleAlert } from 'lucide-react';
import { Button, Input, toast } from '@ruletka/ui';
import { loginFormSchema, type LoginFormValues } from '@/features/auth/schemas';
import { useFieldError } from '@/features/auth/use-field-error';
import { useLogin } from '@/features/auth/use-auth-mutations';
import { banReasonOf, isBannedError } from '@/features/auth/use-appeal';
import { track } from '@/lib/analytics';
import { useErrorMessage } from '@/lib/error-message';
import { AppealDialog } from './appeal-dialog';
import { FormField } from './form-field';
import { PasswordField } from './password-field';

/** Only allow same-origin, absolute-path redirects to avoid open-redirects. */
function safeNext(next: string | null): string {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  // No explicit target → land on the authenticated hub.
  return '/dashboard';
}

export function LoginForm() {
  const t = useTranslations('auth');
  const fieldError = useFieldError();
  const errorMessage = useErrorMessage();
  const params = useSearchParams();
  const login = useLogin();

  // Remember the LAST submitted credentials so the appeal flow (for a banned
  // account) can re-use the email + password the user just typed without asking
  // again. Held only in memory for this screen; cleared when the dialog closes.
  const [lastCredentials, setLastCredentials] = useState<LoginFormValues | null>(null);
  const [appealOpen, setAppealOpen] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onTouched',
  });

  const onSubmit = handleSubmit((values) => {
    setLastCredentials(values);
    login.mutate(values, {
      onSuccess: () => {
        toast.success(t('login.successToast'));
        track('login');
        // Hard navigation: guarantees the freshly-set presence + httpOnly refresh
        // cookies ride the next request. A client router.replace here races Next's
        // prefetch/router cache and bounced to /login; the dashboard re-acquires the
        // access token via the cookie-based refresh on boot.
        window.location.assign(safeNext(params.get('next')));
      },
    });
  });

  // A banned account is rejected with a 403 carrying the ban reason. We surface a
  // dedicated, explanatory banner + an appeal CTA for it (distinct from the 401
  // bad-credentials case).
  const banned = isBannedError(login.error);
  const banReason = banReasonOf(login.error);

  // 401 = bad credentials (the expected rejection). Everything else (network
  // outage, 5xx, unexpected 4xx) routes through the localized error helper so we
  // never surface a raw "Failed to fetch" or an untranslated server string.
  const apiMessage =
    login.error?.status === 401 ? t('login.invalidCredentials') : errorMessage(login.error);

  const busy = isSubmitting || login.isPending;

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold tracking-tight">{t('login.title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('login.subtitle')}</p>
      </header>

      <AnimatePresence>
        {login.isError && banned && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 20 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            role="alert"
            className="overflow-hidden rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-3 text-sm"
          >
            <div className="flex items-start gap-2.5 text-warning">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-semibold">{t('login.bannedTitle')}</p>
                <p className="text-foreground/80">
                  {banReason ? t('login.bannedReason', { reason: banReason }) : t('login.bannedGeneric')}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setAppealOpen(true)}
            >
              {t('login.appealCta')}
            </Button>
          </motion.div>
        )}
        {login.isError && !banned && (
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
              autoFocus
              placeholder={t('fields.emailPlaceholder')}
              leadingIcon={<AtSign />}
              {...register('email')}
            />
          )}
        </FormField>

        <FormField
          label={t('fields.password')}
          required
          error={fieldError(errors.password?.message)}
        >
          {(field) => (
            <PasswordField
              {...field}
              autoComplete="current-password"
              placeholder={t('fields.passwordPlaceholder')}
              {...register('password')}
            />
          )}
        </FormField>

        <div className="-mt-1 flex justify-end">
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-[var(--color-neon-cyan)] hover:underline"
          >
            {t('login.forgotPassword')}
          </Link>
        </div>

        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          {t('login.submit')}
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        {t('login.noAccount')}{' '}
        <Link
          href="/register"
          className="font-semibold text-foreground underline-offset-4 transition-colors hover:text-[var(--color-neon-cyan)] hover:underline"
        >
          {t('login.createAccount')}
        </Link>
      </p>

      {/* Ban-appeal flow — re-uses the credentials the user just typed. Only
          mounted once a banned-login error has captured them. */}
      {lastCredentials && (
        <AppealDialog
          open={appealOpen}
          onOpenChange={setAppealOpen}
          email={lastCredentials.email}
          password={lastCredentials.password}
          banReason={banReason}
        />
      )}
    </div>
  );
}
