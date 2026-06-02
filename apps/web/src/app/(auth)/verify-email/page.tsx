import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { Spinner } from '@ruletka/ui';
import { AuthShell } from '@/components/auth/auth-shell';
import { VerifyEmailView } from '@/components/auth/verify-email-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return {
    title: t('meta.verifyEmail.title'),
    description: t('meta.verifyEmail.description'),
    // Token-bearing utility flow — never index.
    robots: { index: false, follow: false },
  };
}

async function ViewFallback() {
  const t = await getTranslations('auth');
  return (
    <div className="flex min-h-[20rem] items-center justify-center">
      <Spinner size="lg" label={t('shell.loading')} />
    </div>
  );
}

/**
 * /verify-email — confirm an address from the emailed link.
 *
 * The view reads `?token=` via `useSearchParams` and verifies on mount, so it's
 * wrapped in `Suspense` (App Router requirement for client search-param reads).
 */
export default async function VerifyEmailPage() {
  const t = await getTranslations('auth');
  return (
    <AuthShell pitch={t('shell.pitch.verifyEmail')}>
      <Suspense fallback={<ViewFallback />}>
        <VerifyEmailView />
      </Suspense>
    </AuthShell>
  );
}
