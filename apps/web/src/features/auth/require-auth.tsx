'use client';

/**
 * Client-side route guard, a complement to `src/middleware.ts`.
 *
 * Middleware is the primary gate (it blocks the request at the edge before any
 * protected HTML is sent). This component covers the in-app case: client
 * navigations after a token is cleared (e.g. a 401 during the session), where
 * we want to bounce to `/login` without a full reload and show a graceful
 * loading state while the boot/revalidation settles.
 *
 * Wrap the *content* of a protected page:
 *   <RequireAuth><SettingsContent /></RequireAuth>
 */
import { useEffect, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Spinner } from '@ruletka/ui';
import { useAuth } from './use-auth';

export function RequireAuth({ children }: { children: ReactNode }) {
  const tc = useTranslations('common');
  const { isAuthenticated, isReady } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isReady && !isAuthenticated) {
      const next = encodeURIComponent(pathname || '/');
      router.replace(`/login?next=${next}`);
    }
  }, [isReady, isAuthenticated, router, pathname]);

  // While booting, or about to redirect, show a centered spinner rather than a
  // flash of protected UI.
  if (!isReady || !isAuthenticated) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" aria-busy="true">
        <Spinner size="lg" label={tc('loading')} />
      </div>
    );
  }

  return <>{children}</>;
}
