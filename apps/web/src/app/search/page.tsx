'use client';

/**
 * /search — discover people.
 *
 * A live search box + gender/country filters over public profiles. Typing a
 * nickname runs a real free-text search against `GET /profiles/search`
 * (debounced, cursor-paginated, gender/country forwarded as server facets); the
 * cards link to /profile/[id] with quick add-friend & gift actions. When the
 * box is empty the page shows the "Кого посмотреть" discovery rail resolved
 * from the Top feed (see `features/search/use-search.ts`).
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Compass, SearchX, UserSearch, Users } from 'lucide-react';
import { Button } from '@ruletka/ui';
import { EconomyShell } from '@/components/economy/economy-shell';
import { EmptyState, ErrorState } from '@/components/economy/states';
import { SearchFilters } from '@/components/search/search-filters';
import { PersonCard, PersonCardSkeleton } from '@/components/search/person-card';
import {
  useDiscoveryPeople,
  useProfileSearch,
  type GenderFilter,
  type PeopleFilters,
} from '@/features/search/use-search';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export default function SearchPage() {
  const t = useTranslations('misc');
  const [query, setQuery] = useState('');
  const [gender, setGender] = useState<GenderFilter>('any');
  const [country, setCountry] = useState<PeopleFilters['country']>(null);

  const isSearching = query.trim().length > 0;
  const filters: PeopleFilters = { gender, country };

  // Free-text search (active when the box is non-empty); facets forwarded server-side.
  const search = useProfileSearch(query, filters);
  // Default discovery rail (shown when the box is empty); facets applied client-side.
  const discovery = useDiscoveryPeople(filters);

  const hasActiveFilter = gender !== 'any' || country !== null;

  return (
    <EconomyShell
      eyebrow={
        <>
          <UserSearch className="h-3.5 w-3.5 text-[var(--color-neon-violet)]" aria-hidden="true" />
          {t('search.eyebrow')}
        </>
      }
      title={
        <>
          {t('search.titlePrefix')}{' '}
          <span className="text-gradient-neon">{t('search.titleAccent')}</span>
        </>
      }
      lede={t('search.lede')}
    >
      <div className="space-y-8">
        <SearchFilters
          query={query}
          onQueryChange={setQuery}
          // Search is live (debounced) — Enter just keeps the current query.
          onSubmit={() => undefined}
          gender={gender}
          onGenderChange={setGender}
          country={country}
          onCountryChange={setCountry}
        />

        {/* ── Free-text search results (active while the box is non-empty) ── */}
        {isSearching && (
          <section aria-labelledby="results-heading">
            <h2 id="results-heading" className="mb-4 font-display text-lg font-bold tracking-tight">
              {t('search.resultsHeading')}
            </h2>

            {search.isLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <PersonCardSkeleton key={i} />
                ))}
              </div>
            ) : search.isError ? (
              <ErrorState
                title={t('search.lookupErrorTitle')}
                description={t('search.lookupErrorDesc')}
                onRetry={search.refetch}
              />
            ) : search.people.length === 0 ? (
              <EmptyState
                icon={<SearchX className="h-6 w-6" />}
                title={t('search.notFoundTitle')}
                description={t('search.searchNotFoundDesc')}
              />
            ) : (
              <>
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: EASE_OUT }}
                  className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                >
                  {search.people.map((profile, i) => (
                    <PersonCard key={profile.id} profile={profile} index={i} />
                  ))}
                </motion.div>
                {search.hasMore && (
                  <div className="mt-6 flex justify-center">
                    <Button
                      variant="outline"
                      size="md"
                      loading={search.isFetchingMore}
                      onClick={search.fetchMore}
                    >
                      {t('search.loadMore')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* ── Discovery rail (default / empty state) ── */}
        {!isSearching && (
          <section aria-labelledby="discover-heading">
            <div className="mb-4 flex items-center gap-2">
              <Compass className="h-5 w-5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
              <h2 id="discover-heading" className="font-display text-lg font-bold tracking-tight">
                {t('search.discoverHeading')}
              </h2>
            </div>

            {discovery.isLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <PersonCardSkeleton key={i} />
                ))}
              </div>
            ) : discovery.isError ? (
              <ErrorState
                title={t('search.discoverErrorTitle')}
                description={t('search.discoverErrorDesc')}
                onRetry={discovery.refetch}
              />
            ) : discovery.people.length === 0 ? (
              <EmptyState
                icon={<Users className="h-6 w-6" />}
                title={hasActiveFilter ? t('search.emptyFilteredTitle') : t('search.emptyTitle')}
                description={
                  hasActiveFilter ? t('search.emptyFilteredDesc') : t('search.emptyDesc')
                }
                action={
                  hasActiveFilter ? undefined : (
                    <a
                      href="/video"
                      className="text-sm font-medium text-[var(--color-neon-cyan)] hover:text-foreground"
                    >
                      {t('search.toVideoRoulette')}
                    </a>
                  )
                }
              />
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: EASE_OUT }}
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              >
                {discovery.people.map((profile, i) => (
                  <PersonCard key={profile.id} profile={profile} index={i} />
                ))}
              </motion.div>
            )}
          </section>
        )}
      </div>
    </EconomyShell>
  );
}
