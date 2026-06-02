'use client';

/**
 * Client-side provider tree for the whole app.
 *
 * - TanStack Query: the `QueryClient` is created lazily inside `useState` so a
 *   single instance survives re-renders (and React 19 / Strict Mode double
 *   invokes) without leaking state between requests on the server. Global
 *   defaults are tuned for a realtime app talking to a credentialed API
 *   (sensible freshness, jittered exponential backoff, structural sharing).
 * - next-themes: class-based theming (`.dark` on <html>), defaulting to the
 *   user's system preference. `disableTransitionOnChange` prevents a flash of
 *   transitioning colors when the theme flips.
 * - A lightweight {@link RoutePrefetcher} warms the caches behind the most
 *   likely first navigation (the public Top feed + storefront catalogue, and —
 *   once authenticated — the wallet balance), so those screens paint instantly.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClient as QueryClientType,
} from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@ruletka/ui';
import { AuthBootstrapper } from '@/features/auth';
import { useAuthStore } from '@/lib/stores/auth-store';
import { ModalHost } from '@/components/modals';
import { ApiClientError } from '@/lib/api';
import { economyApi, economyKeys } from '@/features/economy/api';
import { useWebPushResync } from '@/features/notifications/use-web-push';

/** Backoff cap (ms) for query retries — keeps a recovering API from thrashing. */
const RETRY_BACKOFF_MAX_MS = 10_000;

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Treat data as fresh for 30s: avoids refetch storms on remount/nav
        // while still keeping fast-moving surfaces reasonably current.
        staleTime: 30_000,
        // Keep unused data cached for 5min so back-navigation is instant.
        gcTime: 5 * 60_000,
        // Don't refetch on focus (the app is realtime via sockets; focus
        // refetches are noisy and waste the credentialed round-trip).
        refetchOnWindowFocus: false,
        // DO refetch when the network comes back — recovers stale screens.
        refetchOnReconnect: true,
        // Retry transient failures with jittered exponential backoff, but never
        // retry a 4xx (auth/permission/not-found are not transient). The api
        // client also back-offs at the transport layer; this guards query-level
        // failures (e.g. a thrown parse) without hammering on client errors.
        retry: (failureCount, error) => {
          if (error instanceof ApiClientError && error.status < 500) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) =>
          Math.min(RETRY_BACKOFF_MAX_MS, 1_000 * 2 ** attempt) * (0.5 + Math.random() * 0.5),
        // Structural sharing is on by default; keep it explicit so referential
        // identity is preserved across refetches (fewer re-renders downstream).
        structuralSharing: true,
      },
      mutations: {
        // Mutations are not idempotent — fail fast and let the UI decide.
        retry: 0,
      },
    },
  });
}

/**
 * Warms the caches behind the most probable next navigation. Runs once the auth
 * boot has settled:
 *  - The public Top feed + coin-package catalogue are prefetched eagerly (they
 *    are public, now edge-cacheable, and surface on the landing + dashboard).
 *  - The wallet balance is prefetched ONLY when authenticated (it is a
 *    credentialed endpoint; warming it anonymously would just 401).
 *
 * `prefetchQuery` is a no-op when the data is already fresh, so this never
 * double-fetches what a mounted screen already loaded. Renders nothing.
 */
function RoutePrefetcher({ queryClient }: { queryClient: QueryClientType }) {
  const isReady = useAuthStore((s) => s.isReady);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isReady) return;

    // Public, cacheable reads — safe to warm regardless of auth.
    void queryClient.prefetchQuery({
      queryKey: economyKeys.topFeed(),
      queryFn: economyApi.topFeed,
      staleTime: 15_000,
    });
    void queryClient.prefetchQuery({
      queryKey: economyKeys.coinPackages(),
      queryFn: economyApi.coinPackages,
      staleTime: 5 * 60_000,
    });

    // Authenticated read — only when we actually have a session.
    if (isAuthenticated) {
      void queryClient.prefetchQuery({
        queryKey: economyKeys.wallet(),
        queryFn: economyApi.wallet,
      });
    }
  }, [isReady, isAuthenticated, queryClient]);

  return null;
}

/**
 * Keeps an already-granted Web Push subscription registered with the API for
 * authenticated users (silent, idempotent; no-op without a VAPID key or an
 * existing subscription). Renders nothing.
 */
function PushResync() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  useWebPushResync(isAuthenticated);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        {/* App-wide tooltip context so any `<Tooltip>` works regardless of the
            page that renders it (Radix requires a `TooltipProvider` ancestor).
            Per-page providers that already exist nest harmlessly under this. */}
        <TooltipProvider delayDuration={200}>
          {/* Hydrates the auth store from a persisted session and binds the
              realtime socket to the current token. Renders nothing. */}
          <AuthBootstrapper />
          {/* Warms likely-next-navigation caches once boot settles. Renders nothing. */}
          <RoutePrefetcher queryClient={queryClient} />
          {/* Re-registers an existing Web Push subscription for signed-in users. */}
          <PushResync />
          {children}
          {/* Single app-wide modal mount point. Reads the global modal store and
              also owns the incoming-call socket listener, so any component can
              `open(...)` a modal without prop-drilling. */}
          <ModalHost />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
