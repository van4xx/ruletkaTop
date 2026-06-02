/**
 * Sentry — Node.js server runtime initialization (Next.js App Router).
 *
 * Imported by `src/instrumentation.ts` via `register()` only when the process
 * runs in the Node.js runtime. Kept at the project root (alongside
 * `next.config.ts`) per the Sentry Next.js convention.
 *
 * FULLY OPTIONAL: with no `SENTRY_DSN` (we also accept `NEXT_PUBLIC_SENTRY_DSN`
 * as a fallback so a single DSN env covers both sides) this returns early and
 * never calls `Sentry.init()` — a clean no-op for dev / CI.
 */
import * as Sentry from '@sentry/nextjs';

const DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment:
      process.env.SENTRY_ENVIRONMENT || process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || undefined,
    release: process.env.SENTRY_RELEASE || process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,

    // Server transaction tracing. Conservative in prod; override via
    // SENTRY_TRACES_SAMPLE_RATE.
    tracesSampleRate: parseRate(
      process.env.SENTRY_TRACES_SAMPLE_RATE,
      process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    ),

    // Minimal data by default (no request bodies / headers / cookies).
    sendDefaultPii: false,

    debug: process.env.SENTRY_DEBUG === 'true',
  });
}

function parseRate(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}
