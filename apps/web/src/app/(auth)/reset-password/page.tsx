import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { Spinner } from '@ruletka/ui';
import { AuthShell } from '@/components/auth/auth-shell';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return {
    title: t('meta.resetPassword.title'),
    description: t('meta.resetPassword.description'),
    // Token-bearing utility flow — never index.
    robots: { index: false, follow: false },
  };
}

async function FormFallback() {
  const t = await getTranslations('auth');
  return (
    <div className="flex min-h-[20rem] items-center justify-center">
      <Spinner size="lg" label={t('shell.loading')} />
    </div>
  );
}

/**
 * /reset-password — set a new password from the emailed link.
 *
 * The form reads `?token=` via `useSearchParams`, so it's wrapped in `Suspense`
 * (App Router requirement for client search-param reads).
 */
export default async function ResetPasswordPage() {
  const t = await getTranslations('auth');
  return (
    <AuthShell pitch={t('shell.pitch.resetPassword')}>
      <Suspense fallback={<FormFallback />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
