'use client';

/**
 * Root-level error boundary (App Router `global-error.tsx`).
 *
 * Next.js renders THIS — instead of the normal `error.tsx` — when the error
 * originates in the root layout itself (e.g. a provider crashes during boot).
 * Because it replaces the entire document, it must render its own `<html>` and
 * `<body>` and cannot rely on the root layout's fonts, theme, or Tailwind
 * layers being present. We therefore use inline styles for a dependency-free,
 * always-renderable fallback.
 *
 * Its primary job for observability is to forward the fatal error to Sentry.
 * `Sentry.captureException` is a no-op when no DSN is configured, so this is
 * safe in dev / CI.
 */
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          background: '#0a0a0f',
          color: '#e7e7ea',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 0.75rem' }}>
            Что-то пошло не так
          </h1>
          <p style={{ color: '#a1a1aa', lineHeight: 1.6, margin: '0 0 1.5rem' }}>
            Произошла критическая ошибка. Попробуйте обновить страницу — обычно это решает проблему.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              cursor: 'pointer',
              border: 'none',
              borderRadius: '0.75rem',
              padding: '0.625rem 1.25rem',
              fontSize: '0.9375rem',
              fontWeight: 600,
              color: '#0a0a0f',
              background: 'linear-gradient(135deg, #a855f7, #ec4899)',
            }}
          >
            Попробовать снова
          </button>
          {error.digest && (
            <p style={{ marginTop: '1.5rem', fontSize: '0.75rem', color: '#71717a' }}>
              Код ошибки:{' '}
              <span style={{ fontFamily: 'ui-monospace, monospace' }}>{error.digest}</span>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
