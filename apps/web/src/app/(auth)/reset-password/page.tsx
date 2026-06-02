import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Spinner } from '@ruletka/ui';
import { AuthShell } from '@/components/auth/auth-shell';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export const metadata: Metadata = {
  title: 'Новый пароль',
  description: 'Задайте новый пароль для аккаунта ruletka.top.',
  // Token-bearing utility flow — never index.
  robots: { index: false, follow: false },
};

function FormFallback() {
  return (
    <div className="flex min-h-[20rem] items-center justify-center">
      <Spinner size="lg" label="Загрузка" />
    </div>
  );
}

/**
 * /reset-password — set a new password from the emailed link.
 *
 * The form reads `?token=` via `useSearchParams`, so it's wrapped in `Suspense`
 * (App Router requirement for client search-param reads).
 */
export default function ResetPasswordPage() {
  return (
    <AuthShell pitch="Один шаг — и снова в эфире">
      <Suspense fallback={<FormFallback />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
