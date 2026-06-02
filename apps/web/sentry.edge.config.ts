/**
 * Sentry — Edge runtime initialization (Next.js middleware + edge routes).
 *
 * Imported by `src/instrumentation.ts` via `register()` only when the process
 * runs in the Edge runtime. Kept minimal: the Edge runtime is a constrained
 * environment, so we configure only error capture + light tracing.
 *
 * FULLY OPTIONAL: no DSN ⇒ early return, no `Sentry.init()`, clean no-op.
 */
import * as Sentry from '@sentry/nextjs';

const DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment:
      process.env.SENTRY_ENVIRONMENT || process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || undefined,
    release: process.env.SENTRY_RELEASE || process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
    tracesSampleRate: parseRate(
      process.env.SENTRY_TRACES_SAMPLE_RATE,
      process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    ),
    sendDefaultPii: false,
    debug: process.env.SENTRY_DEBUG === 'true',
  });
}

function parseRate(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}
