'use client';

/**
 * Matchmaking filters store.
 *
 * Holds the user's chosen roulette filters (gender preference, age range,
 * countries) so the {@link FiltersModal} can edit them and the roulette stage
 * can read them when joining the queue (`mm:join` payload). Persisted to
 * localStorage so a refresh keeps the user's last filters.
 *
 * The shape is the contract's {@link MatchFilters}; we validate persisted JSON
 * against `matchFiltersSchema` on load so a stale/corrupt blob can't break the
 * roulette.
 *
 * NOTE: gender/country filtering is a premium capability on the server. The
 * store always holds the user's *intent*; gating (and disabling the controls
 * for non-premium users) lives in the modal, not here.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { matchFiltersSchema, type MatchFilters } from '@ruletka/shared-types';

/** The default "no filters" selection (matches the schema defaults). */
export const DEFAULT_FILTERS: MatchFilters = {
  gender: 'any',
  ageMin: 18,
  ageMax: 120,
  countries: [],
  sharedInterestsOnly: false,
};

interface FiltersState {
  filters: MatchFilters;
  /** Replace the whole filter set (validated; invalid input is ignored). */
  setFilters: (next: MatchFilters) => void;
  /** Patch a subset of the filters. */
  patchFilters: (patch: Partial<MatchFilters>) => void;
  /** Reset back to the permissive defaults. */
  reset: () => void;
  /** True when any filter differs from the defaults (drives a header badge). */
  hasActiveFilters: () => boolean;
}

function isDefault(f: MatchFilters): boolean {
  return (
    f.gender === DEFAULT_FILTERS.gender &&
    f.ageMin === DEFAULT_FILTERS.ageMin &&
    f.ageMax === DEFAULT_FILTERS.ageMax &&
    f.countries.length === 0 &&
    !f.sharedInterestsOnly
  );
}

export const useFiltersStore = create<FiltersState>()(
  persist(
    (set, get) => ({
      filters: DEFAULT_FILTERS,
      setFilters: (next) => {
        const parsed = matchFiltersSchema.safeParse(next);
        if (parsed.success) set({ filters: parsed.data });
      },
      patchFilters: (patch) => {
        const merged = { ...get().filters, ...patch };
        const parsed = matchFiltersSchema.safeParse(merged);
        if (parsed.success) set({ filters: parsed.data });
      },
      reset: () => set({ filters: DEFAULT_FILTERS }),
      hasActiveFilters: () => !isDefault(get().filters),
    }),
    {
      name: 'ruletka.filters',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Validate the persisted blob; fall back to defaults if it's stale/corrupt.
      merge: (persisted, current) => {
        const parsed = matchFiltersSchema.safeParse(
          (persisted as { filters?: unknown } | undefined)?.filters,
        );
        return { ...current, filters: parsed.success ? parsed.data : DEFAULT_FILTERS };
      },
    },
  ),
);

/** Convenience selector: just the current filters object. */
export function useMatchFilters(): MatchFilters {
  return useFiltersStore((s) => s.filters);
}
