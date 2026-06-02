'use client';

/**
 * Search controls: a query box (submits on Enter), a gender segmented control,
 * and a single-select country picker (reusing the design system's
 * {@link CountrySelect}). Purely presentational — state lives in the page.
 */
import { useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';
import type { CountryCode, Gender } from '@ruletka/shared-types';
import { CountrySelect, IconButton, Input } from '@ruletka/ui';
import { cn } from '@/lib/cn';

export type GenderFilter = Gender | 'any';

const GENDERS: { value: GenderFilter; labelKey: string }[] = [
  { value: 'any', labelKey: 'search.filterGenderAny' },
  { value: 'female', labelKey: 'search.filterGenderFemale' },
  { value: 'male', labelKey: 'search.filterGenderMale' },
  { value: 'other', labelKey: 'search.filterGenderOther' },
];

export interface SearchFiltersProps {
  query: string;
  onQueryChange: (q: string) => void;
  onSubmit: () => void;
  gender: GenderFilter;
  onGenderChange: (g: GenderFilter) => void;
  country: CountryCode | null;
  onCountryChange: (c: CountryCode | null) => void;
}

export function SearchFilters({
  query,
  onQueryChange,
  onSubmit,
  gender,
  onGenderChange,
  country,
  onCountryChange,
}: SearchFiltersProps) {
  const t = useTranslations('misc');
  return (
    <div className="glass-panel space-y-4 rounded-2xl p-4 sm:p-5">
      {/* Query */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        role="search"
      >
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t('search.filterQueryPlaceholder')}
          size="lg"
          leadingIcon={<Search className="h-5 w-5" />}
          trailingIcon={
            query ? (
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('search.filterClearAria')}
                onClick={() => onQueryChange('')}
              >
                <X aria-hidden="true" />
              </IconButton>
            ) : undefined
          }
          aria-label={t('search.filterSearchAria')}
          autoComplete="off"
          spellCheck={false}
        />
      </form>

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('search.filterGender')}
          </span>
          <div
            className="inline-flex w-full rounded-xl bg-card/50 p-1 ring-1 ring-border/60 sm:w-auto"
            role="radiogroup"
            aria-label={t('search.filterGenderAria')}
          >
            {GENDERS.map((g) => {
              const active = gender === g.value;
              return (
                <button
                  key={g.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onGenderChange(g.value)}
                  className={cn(
                    'flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                    active
                      ? 'bg-aurora text-accent-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(g.labelKey)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('search.filterCountry')}
          </span>
          <CountrySelect
            value={country ? [country] : []}
            onChange={(codes) => onCountryChange(codes[codes.length - 1] ?? null)}
            maxSelections={1}
            placeholder={t('search.filterCountryPlaceholder')}
            aria-label={t('search.filterCountryAria')}
          />
        </div>
      </div>
    </div>
  );
}
