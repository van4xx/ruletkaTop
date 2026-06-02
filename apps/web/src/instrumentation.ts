/**
 * Next.js instrumentation hook (App Router).
 *
 * `register()` runs once when the server process boots. We lazily import the
 * matching Sentry runtime config (Node.js vs Edge) so each runtime only loads
 * what it needs. Both configs are themselves no-ops without a DSN, so this is
 * safe to keep wired in dev / CI.
 *
 * `onRequestError` forwards uncaught errors from React Server Components, route
 * handlers, and server actions to Sentry. It is `Sentry.captureRequestError`,
 * which is a harmless no-op when the SDK was never initialized (no DSN).
 *
 * Requires @sentry/nextjs >= 8.28 and Next 15+ (we are on Next 16).
 */
import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
