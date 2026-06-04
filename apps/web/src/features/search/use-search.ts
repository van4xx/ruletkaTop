'use client';

/**
 * People-discovery data layer for /search.
 *
 * Two complementary paths over the real API:
 *   1. {@link useProfileSearch} — free-text nickname search via
 *      `GET /profiles/search?q=&gender=&country=&cursor=&limit=`. The query
 *      string is debounced, gender/country facets are forwarded as server
 *      filters, results are cursor-paginated, and a superseded request is
 *      cancelled via its `AbortSignal`. This is the active path whenever the
 *      search box is non-empty.
 *   2. {@link useDiscoveryPeople} — the DEFAULT/empty state: resolves the
 *      current Top feed's placements to public profiles for an on-brand
 *      "Кого посмотреть" rail, filterable client-side by gender / country. Shown
 *      when the search box is empty.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  useInfiniteQuery,
  useQueries,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import type { CountryCode, Gender, PublicProfile } from '@ruletka/shared-types';

import { api, ApiClientError, type ProfileSearchPage } from '@/lib/api';
import { useTopFeed } from '@/features/top/use-top';

/** Whether the backend exposes a people-search endpoint (`GET /profiles/search`). */
export const HAS_PROFILE_SEARCH = true;

/** Page size requested per `GET /profiles/search` round-trip. */
const SEARCH_PAGE_SIZE = 24;
/** Debounce (ms) applied to the live query string before it hits the network. */
const SEARCH_DEBOUNCE_MS = 350;

/** A gender facet, or `'any'` (no gender filter). */
export type GenderFilter = Gender | 'any';

/** Gender + country facets shared by search and discovery. */
export interface PeopleFilters {
  gender: GenderFilter;
  country: CountryCode | null;
}

export const searchKeys = {
  all: ['search'] as const,
  profile: (id: string) => [...searchKeys.all, 'profile', id] as const,
  /** Query key for a free-text search (query string + facets). */
  query: (q: string, gender: GenderFilter, country: CountryCode | null) =>
    [...searchKeys.all, 'query', { q, gender, country }] as const,
};

/** Fetch a single public profile by id (the correct plural `/profiles/:id`). */
function fetchProfile(id: string): Promise<PublicProfile | null> {
  return api.profile.byId(id).catch((err) => {
    if (err instanceof ApiClientError && err.status === 404) return null;
    throw err;
  });
}

/**
 * Debounce a fast-changing value, so the live search query only reaches the
 * network once the user pauses typing.
 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export interface ProfileSearchResult {
  /** All loaded profiles, flattened across pages (newest-first). */
  people: PublicProfile[];
  isLoading: boolean;
  isError: boolean;
  /** Whether another page can be loaded. */
  hasMore: boolean;
  /** True while a follow-up page is being fetched. */
  isFetchingMore: boolean;
  /** True once the debounce has caught up with the live input. */
  isDebouncing: boolean;
  fetchMore: () => void;
  refetch: () => void;
}

/**
 * Free-text people search backed by `GET /profiles/search`.
 *
 * The `query` string is debounced; `filters` (gender/country) are forwarded as
 * server-side facets. Results are cursor-paginated (`fetchMore` loads the next
 * page). TanStack Query passes an `AbortSignal` into the fetcher, so when the
 * debounced query/filters change the in-flight request is cancelled — stale
 * responses never overwrite fresh ones. `enabled` only when there is something
 * to filter on (a non-empty query OR an active facet); the empty/no-filter case
 * is the discovery rail's job (see {@link useDiscoveryPeople}).
 */
export function useProfileSearch(query: string, filters: PeopleFilters): ProfileSearchResult {
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const gender = filters.gender;
  const country = filters.country;

  const hasQuery = debouncedQuery.length > 0;
  const hasFacet = gender !== 'any' || country !== null;
  const enabled = hasQuery || hasFacet;

  const result: UseInfiniteQueryResult<InfiniteData<ProfileSearchPage, string | undefined>, Error> =
    useInfiniteQuery({
      queryKey: searchKeys.query(debouncedQuery, gender, country),
      queryFn: ({ pageParam, signal }) =>
        api.profiles.search(
          {
            q: hasQuery ? debouncedQuery : undefined,
            gender: gender === 'any' ? undefined : gender,
            country: country ?? undefined,
            cursor: pageParam,
            limit: SEARCH_PAGE_SIZE,
          },
          signal,
        ),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
      enabled,
      staleTime: 30_000,
      retry: false,
    });

  const people = useMemo<PublicProfile[]>(
    () => result.data?.pages.flatMap((p) => p.items) ?? [],
    [result.data],
  );

  // The live input is "ahead" of the debounced value while the user is still
  // typing — surface that so the UI can show a pending state instead of a
  // premature "nobody found".
  const isDebouncing = query.trim() !== debouncedQuery;

  return {
    people,
    // Treat the debounce gap as loading so the empty state never flashes between
    // keystrokes (an enabled query is `isPending` until its first page settles).
    isLoading: enabled && (result.isPending || isDebouncing),
    isError: result.isError,
    hasMore: Boolean(result.hasNextPage),
    isFetchingMore: result.isFetchingNextPage,
    isDebouncing,
    fetchMore: () => {
      if (result.hasNextPage && !result.isFetchingNextPage) void result.fetchNextPage();
    },
    refetch: () => void result.refetch(),
  };
}

export interface DiscoveryFilters {
  gender: GenderFilter;
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
 * if some lookups fail (failed ones are simply omitted). This is the DEFAULT
 * rail shown when the search box is empty.
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
    () => profileQueries.map((q) => q.data).filter((p): p is PublicProfile => Boolean(p)),
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
