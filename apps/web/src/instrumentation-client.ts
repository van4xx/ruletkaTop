/**
 * Sentry — browser (client) initialization for the Next.js App Router.
 *
 * Next 16 loads this file automatically on the client (the App-Router successor
 * to the old `sentry.client.config.ts`). It runs before the app hydrates.
 *
 * FULLY OPTIONAL: with no `NEXT_PUBLIC_SENTRY_DSN` set we return early and never
 * call `Sentry.init()`, so the SDK stays dormant (no network, no overhead) and
 * dev / CI builds are unaffected. The `onRouterTransitionStart` export below is
 * safe to keep regardless — without an active client it is a harmless no-op.
 */
import * as Sentry from '@sentry/nextjs';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    // Optional explicit environment / release (blank ⇒ Sentry infers them).
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || undefined,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,

    // Performance tracing. Modest in prod to control event volume; full in dev.
    // Override via NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE.
    tracesSampleRate: parseRate(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
      process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    ),

    // Session Replay — sample a small slice of sessions, but capture replays for
    // sessions that hit an error. Gated behind NEXT_PUBLIC_SENTRY_ENABLE_REPLAY
    // so it stays off (zero extra client weight cost beyond the SDK) by default.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: process.env.NEXT_PUBLIC_SENTRY_ENABLE_REPLAY === 'true' ? 1.0 : 0,
    integrations:
      process.env.NEXT_PUBLIC_SENTRY_ENABLE_REPLAY === 'true'
        ? [Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })]
        : [],

    // Privacy: do NOT attach PII (IP, cookies, headers) unless explicitly opted
    // in. This app handles personal communication — default to minimal data.
    sendDefaultPii: false,

    // Quiet unless explicitly debugging the SDK itself.
    debug: process.env.NEXT_PUBLIC_SENTRY_DEBUG === 'true',
  });
}

/** Parse a 0..1 sample-rate env string, falling back when unset/invalid. */
function parseRate(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

/**
 * Instruments App-Router client-side navigations for tracing. Required export
 * for navigation spans under `@sentry/nextjs` v9+. No-op when Sentry is not
 * initialized (no DSN), so it is always safe to export.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
