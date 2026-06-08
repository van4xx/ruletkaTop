'use client';

/**
 * Shared scoped error boundary body for route-group `error.tsx` files. Next.js
 * requires each segment's `error.tsx` to be a client component exporting a
 * default `{ error, reset }` component; this factors out the identical
 * brand-styled recovery UI so every group reuses one implementation (matching
 * the GLOBAL `app/error.tsx`).
 *
 * A SCOPED boundary only resets its own subtree — the surrounding chrome
 * (header / footer / nav) stays mounted, so a nested crash no longer blacks out
 * the whole app.
 */
import { useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Home, RotateCcw } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';
import { Button } from '@ruletka/ui';
import { SystemScreen } from '@/components/system/system-screen';
import { ROUTES } from '@/config/nav';

export function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('misc');
  // Forward to Sentry (no-op when no DSN) and log in dev.
  useEffect(() => {
    Sentry.captureException(error);

    console.error(error);
  }, [error]);

  return (
    <SystemScreen
      tone="danger"
      icon={<AlertTriangle className="h-8 w-8" aria-hidden="true" />}
      title={t('system.errorTitle')}
      description={t('system.errorDesc')}
      actions={
        <>
          <Button size="lg" leadingIcon={<RotateCcw className="h-5 w-5" />} onClick={() => reset()}>
            {t('system.tryAgain')}
          </Button>
          <Button asChild variant="outline" size="lg" leadingIcon={<Home className="h-5 w-5" />}>
            <Link href={ROUTES.home}>{t('system.goHome')}</Link>
          </Button>
        </>
      }
    >
      {error.digest && (
        <p className="mt-6 text-xs text-muted-foreground/60">
          {t('system.errorCode')} <span className="font-mono">{error.digest}</span>
        </p>
      )}
    </SystemScreen>
  );
}
