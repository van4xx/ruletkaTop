'use client';

/**
 * /search — discover people.
 *
 * A search box + gender/country filters over public profiles. Result cards link
 * to /profile/[id] with quick add-friend & gift actions.
 *
 * ── Contract gap (flagged for the integrator / backend) ──────────────────────
 * There is NO people-search endpoint (`GET /profiles/search?q=&gender=&country=`
 * is needed). Until it lands, this page provides two real discovery paths on
 * the existing API (see `features/search/use-search.ts`):
 *   • exact lookup by profile ID (GET /profiles/:id) — wired to the search box,
 *   • a "Кого посмотреть" rail resolved from the Top feed (GET /top), filterable
 *     client-side by gender / country.
 * Free-text name queries show a clear, on-brand placeholder explaining this.
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Compass, Info, SearchX, UserSearch, Users } from 'lucide-react';
import { objectIdSchema } from '@ruletka/shared-types';
import { EconomyShell } from '@/components/economy/economy-shell';
import { EmptyState, ErrorState } from '@/components/economy/states';
import { SearchFilters, type GenderFilter } from '@/components/search/search-filters';
import { PersonCard, PersonCardSkeleton } from '@/components/search/person-card';
import {
  useDiscoveryPeople,
  useProfileLookup,
  type DiscoveryFilters,
} from '@/features/search/use-search';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [gender, setGender] = useState<GenderFilter>('any');
  const [country, setCountry] = useState<DiscoveryFilters['country']>(null);

  // A submitted query that is a valid id triggers an exact lookup.
  const lookupId = useMemo(() => {
    const trimmed = submitted.trim();
    return objectIdSchema.safeParse(trimmed).success ? trimmed : null;
  }, [submitted]);
  const isFreeText = submitted.trim().length > 0 && !lookupId;

  const lookup = useProfileLookup(lookupId);
  const discovery = useDiscoveryPeople({ gender, country });

  const hasActiveFilter = gender !== 'any' || country !== null;

  return (
    <EconomyShell
      eyebrow={
        <>
          <UserSearch className="h-3.5 w-3.5 text-[var(--color-neon-violet)]" aria-hidden="true" />
          Поиск людей
        </>
      }
      title={
        <>
          Найдите <span className="text-gradient-neon">собеседника</span>
        </>
      }
      lede="Ищите людей по имени или ID и фильтруйте по полу и стране. Добавляйте в друзья и дарите подарки прямо отсюда."
    >
      <div className="space-y-8">
        <SearchFilters
          query={query}
          onQueryChange={setQuery}
          onSubmit={() => setSubmitted(query)}
          gender={gender}
          onGenderChange={setGender}
          country={country}
          onCountryChange={setCountry}
        />

        {/* ── Search results (exact id lookup or free-text notice) ── */}
        {submitted.trim().length > 0 && (
          <section aria-labelledby="results-heading">
            <h2 id="results-heading" className="mb-4 font-display text-lg font-bold tracking-tight">
              Результаты поиска
            </h2>

            {isFreeText ? (
              <div className="glass-panel flex items-start gap-3 rounded-2xl border-l-2 border-l-[var(--color-neon-cyan)]/60 p-4 text-sm">
                <Info
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-neon-cyan)]"
                  aria-hidden="true"
                />
                <p className="text-muted-foreground">
                  Поиск по имени скоро заработает. Сейчас можно найти человека по{' '}
                  <span className="font-medium text-foreground">ID профиля</span> (24 символа) или
                  выбрать кого-то из подборки ниже.
                </p>
              </div>
            ) : lookup.isLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <PersonCardSkeleton />
              </div>
            ) : lookup.isError ? (
              <ErrorState
                title="Не удалось выполнить поиск"
                description="Попробуйте ещё раз чуть позже."
                onRetry={() => lookup.refetch()}
              />
            ) : lookup.data ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <PersonCard profile={lookup.data} />
              </div>
            ) : (
              <EmptyState
                icon={<SearchX className="h-6 w-6" />}
                title="Никого не нашлось"
                description="Профиль с таким ID не найден. Проверьте ID и попробуйте снова."
              />
            )}
          </section>
        )}

        {/* ── Discovery rail ── */}
        <section aria-labelledby="discover-heading">
          <div className="mb-4 flex items-center gap-2">
            <Compass className="h-5 w-5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
            <h2 id="discover-heading" className="font-display text-lg font-bold tracking-tight">
              Кого посмотреть
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
              title="Не удалось загрузить подборку"
              description="Подборка людей временно недоступна."
              onRetry={discovery.refetch}
            />
          ) : discovery.people.length === 0 ? (
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title={
                hasActiveFilter ? 'Под фильтры никто не подходит' : 'Пока некого показать'
              }
              description={
                hasActiveFilter
                  ? 'Попробуйте смягчить фильтры по полу или стране.'
                  : 'Загляните в рулетку, чтобы знакомиться с новыми людьми вживую.'
              }
              action={
                hasActiveFilter ? undefined : (
                  <a
                    href="/video"
                    className="text-sm font-medium text-[var(--color-neon-cyan)] hover:text-foreground"
                  >
                    В видеорулетку →
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
      </div>
    </EconomyShell>
  );
}
