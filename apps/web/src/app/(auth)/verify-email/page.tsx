import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Spinner } from '@ruletka/ui';
import { AuthShell } from '@/components/auth/auth-shell';
import { VerifyEmailView } from '@/components/auth/verify-email-view';

export const metadata: Metadata = {
  title: 'Подтверждение email',
  description: 'Подтвердите ваш email-адрес на ruletka.top.',
  // Token-bearing utility flow — never index.
  robots: { index: false, follow: false },
};

function ViewFallback() {
  return (
    <div className="flex min-h-[20rem] items-center justify-center">
      <Spinner size="lg" label="Загрузка" />
    </div>
  );
}

/**
 * /verify-email — confirm an address from the emailed link.
 *
 * The view reads `?token=` via `useSearchParams` and verifies on mount, so it's
 * wrapped in `Suspense` (App Router requirement for client search-param reads).
 */
export default function VerifyEmailPage() {
  return (
    <AuthShell pitch="Подтвердите почту — и в эфир">
      <Suspense fallback={<ViewFallback />}>
        <VerifyEmailView />
      </Suspense>
    </AuthShell>
  );
}
