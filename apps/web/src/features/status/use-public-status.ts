'use client';

/**
 * Public operational-status hook (`GET /public/status`).
 *
 * Surfaces the live, admin-toggleable flags — `maintenanceMode`,
 * `registrationOpen`, `matchmakingEnabled` — that the API serves UNAUTHENTICATED.
 * Used by the site-wide maintenance banner and the register form's
 * "registration closed" gate, so it must work signed-OUT too: the underlying
 * call sets `skipAuth`, and we do NOT gate it on auth-ready like the private
 * queries do.
 *
 * Polling is deliberately modest so we never hammer the endpoint:
 *   • `staleTime` 60s — within a minute, cache hits are served with no refetch.
 *   • `refetchInterval` 60s — a quiet background refresh so a flag flip (e.g. an
 *     admin opening maintenance mode) lands within ~a minute without a reload.
 *   • `refetchOnWindowFocus` — pick up a change the moment the user returns to
 *     the tab (TanStack still respects `staleTime`, so a focus inside the 60s
 *     window costs nothing).
 *
 * Failures are swallowed at the UI layer: a status fetch that errors should
 * never break the page (banner just stays hidden, register stays enabled), so
 * we don't retry aggressively here.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { PublicStatus } from '@ruletka/shared-types';
import { api, ApiClientError } from '@/lib/api';

/** TanStack query key for the public status flags. */
export const PUBLIC_STATUS_KEY = ['public', 'status'] as const;

/** Poll the public operational-status flags (works signed-in AND signed-out). */
export function usePublicStatus(): UseQueryResult<PublicStatus, ApiClientError> {
  return useQuery<PublicStatus, ApiClientError>({
    queryKey: PUBLIC_STATUS_KEY,
    queryFn: ({ signal }) => api.public.status(signal),
    // Modest polling — do NOT hammer the endpoint (see file header).
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    // A transient status error must never cascade into the UI; one quiet retry
    // is plenty (the next interval tick recovers anyway).
    retry: 1,
  });
}
