'use client';

/**
 * Mount once near the app root (ideally inside `providers.tsx`, alongside the
 * QueryClient + ThemeProvider) to hydrate the auth store from a persisted
 * session and keep the realtime socket bound to the current token.
 *
 * Renders nothing. Kept as a standalone component so the integrator can wire it
 * without this feature having to touch the shared `providers.tsx`.
 */
import { useAuthBootstrap } from './use-auth';

export function AuthBootstrapper(): null {
  useAuthBootstrap();
  return null;
}
