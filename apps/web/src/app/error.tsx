'use client';

/**
 * Global client error boundary (App Router). Next.js renders this when an
 * uncaught error bubbles up from a route segment. Provides a brand-styled
 * recovery screen with a `reset()` retry and a route home.
 *
 * Must be a Client Component and accept `{ error, reset }` per the App Router
 * contract.
 */
import { useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Home, RotateCcw } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';
import { Button } from '@ruletka/ui';
import { SystemScreen } from '@/components/system/system-screen';
import { ROUTES } from '@/config/nav';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('misc');
  // Surface the error to the console (dev) and forward it to Sentry. When no
  // DSN is configured the SDK is uninitialized and `captureException` is a
  // harmless no-op, so this is safe in dev / CI.
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
