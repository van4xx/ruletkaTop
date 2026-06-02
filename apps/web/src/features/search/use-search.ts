'use client';

/**
 * People-discovery data layer for /search.
 *
 * ── Contract gap (flagged for the integrator / backend) ──────────────────────
 * There is NO people-search endpoint (no `GET /profiles/search`). The only
 * profile reads are `GET /profiles/:id` (single) and `GET /top` (the paid feed,
 * which yields userIds). So this hook offers two REAL discovery paths built on
 * the existing API:
 *   1. {@link useProfileLookup} — exact lookup by profile ID (GET /profiles/:id),
 *      which doubles as the "search" action until free-text search exists.
 *   2. {@link useDiscoveryPeople} — resolves the current Top feed's placements
 *      to public profiles, giving a populated, on-brand "Кого посмотреть" rail
 *      that can be filtered client-side by gender / country.
 *
 * When `GET /profiles/search?q=&gender=&country=` lands, replace
 * {@link useDiscoveryPeople}'s client-side filtering with a server query.
 */
import { useMemo } from 'react';
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { CountryCode, Gender, PublicProfile } from '@ruletka/shared-types';

import { api, ApiClientError } from '@/lib/api';
import { useTopFeed } from '@/features/top/use-top';

/** Whether the backend exposes a people-search endpoint. */
export const HAS_PROFILE_SEARCH = false;

export const searchKeys = {
  all: ['search'] as const,
  profile: (id: string) => [...searchKeys.all, 'profile', id] as const,
};

/** Fetch a single public profile by id (the correct plural `/profiles/:id`). */
function fetchProfile(id: string): Promise<PublicProfile | null> {
  return api.request<PublicProfile>(`/profiles/${id}`).catch((err) => {
    if (err instanceof ApiClientError && err.status === 404) return null;
    throw err;
  });
}

/**
 * Exact profile lookup by id — enabled only for a well-formed 24-char id. Acts
 * as the working "search" until free-text search exists.
 */
export function useProfileLookup(id: string | null): UseQueryResult<PublicProfile | null> {
  return useQuery({
    queryKey: searchKeys.profile(id ?? 'none'),
    queryFn: () => fetchProfile(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
    retry: false,
  });
}

export interface DiscoveryFilters {
  gender: Gender | 'any';
  country: CountryCode | null;
}

export interface DiscoveryResult {
  people: PublicProfile[];
  isLoading: boolean;
  isError: boolean;
  /** Total resolved before client-side filtering (for empty-vs-filtered copy). */
  totalResolved: number;
  refetch: () => void;
}

/**
 * Resolve the Top feed's placements to public profiles, de-duplicated by user,
 * then apply client-side gender/country filters. Returns a graceful list even
 * if some lookups fail (failed ones are simply omitted).
 */
export function useDiscoveryPeople(filters: DiscoveryFilters): DiscoveryResult {
  const feed = useTopFeed();

  // Unique user ids across both lanes, capped to keep lookups bounded.
  const userIds = useMemo(() => {
    const all = [...(feed.data?.left ?? []), ...(feed.data?.right ?? [])];
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const placement of all) {
      if (!seen.has(placement.userId)) {
        seen.add(placement.userId);
        ids.push(placement.userId);
      }
    }
    return ids.slice(0, 24);
  }, [feed.data]);

  const profileQueries = useQueries({
    queries: userIds.map((id) => ({
      queryKey: searchKeys.profile(id),
      queryFn: () => fetchProfile(id),
      staleTime: 5 * 60_000,
      retry: false,
    })),
  });

  const resolved = useMemo(
    () =>
      profileQueries
        .map((q) => q.data)
        .filter((p): p is PublicProfile => Boolean(p)),
    [profileQueries],
  );

  const people = useMemo(() => {
    return resolved.filter((p) => {
      if (filters.gender !== 'any' && p.gender !== filters.gender) return false;
      if (filters.country && p.country !== filters.country) return false;
      return true;
    });
  }, [resolved, filters.gender, filters.country]);

  const isLoadingProfiles = profileQueries.some((q) => q.isLoading);

  return {
    people,
    isLoading: feed.isLoading || (userIds.length > 0 && isLoadingProfiles && resolved.length === 0),
    isError: feed.isError,
    totalResolved: resolved.length,
    refetch: () => void feed.refetch(),
  };
}
