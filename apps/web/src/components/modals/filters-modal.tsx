'use client';

/**
 * Matchmaking filters editor. Edits a local draft of the filters
 * (gender preference, age range, countries), validates it against the shared
 * `matchFiltersSchema`, then commits it to the persisted filters store for the
 * roulette to read on its next `mm:join`.
 *
 * Gender + country filtering is a premium capability (enforced server-side), so
 * those controls are disabled for non-premium viewers with an upsell. The age
 * range is always available.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Crown, RotateCcw, SlidersHorizontal, Sparkles, Venus, Mars, Users } from 'lucide-react';
import type { CountryCode, GenderPreference, MatchFilters } from '@ruletka/shared-types';
import {
  Badge,
  Button,
  CountrySelect,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Slider,
  Switch,
} from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { useModal } from '@/lib/stores/modal-store';
import { DEFAULT_FILTERS, useFiltersStore } from '@/lib/stores/filters-store';
import { useIsPremium } from '@/features/economy/use-me';

const AGE_MIN = 18;
const AGE_MAX = 100;

const GENDER_ICONS: Record<GenderPreference, React.ElementType> = {
  any: Users,
  male: Mars,
  female: Venus,
};

export function FiltersModal() {
  const { close, open } = useModal();
  const t = useTranslations('chrome');
  const committed = useFiltersStore((s) => s.filters);
  const setFilters = useFiltersStore((s) => s.setFilters);
  const reset = useFiltersStore((s) => s.reset);
  const isPremium = useIsPremium();

  const GENDERS: Array<{ value: GenderPreference; label: string; icon: React.ElementType }> = [
    { value: 'any', label: t('modals.filters.genderAny'), icon: GENDER_ICONS.any },
    { value: 'male', label: t('modals.filters.genderMale'), icon: GENDER_ICONS.male },
    { value: 'female', label: t('modals.filters.genderFemale'), icon: GENDER_ICONS.female },
  ];

  // Local editable draft (clamped to the slider's 18..100 range).
  const [draft, setDraft] = useState<MatchFilters>(() => ({
    ...committed,
    ageMin: Math.max(AGE_MIN, Math.min(AGE_MAX, committed.ageMin)),
    ageMax: Math.max(AGE_MIN, Math.min(AGE_MAX, committed.ageMax)),
  }));

  // Re-seed if the committed filters change while open (rare, but correct).
  useEffect(() => {
    setDraft({
      ...committed,
      ageMin: Math.max(AGE_MIN, Math.min(AGE_MAX, committed.ageMin)),
      ageMax: Math.max(AGE_MIN, Math.min(AGE_MAX, committed.ageMax)),
    });
  }, [committed]);

  const premiumLocked = !isPremium;

  const isDirty = useMemo(
    () =>
      draft.gender !== committed.gender ||
      draft.ageMin !== committed.ageMin ||
      draft.ageMax !== committed.ageMax ||
      draft.countries.join(',') !== committed.countries.join(',') ||
      draft.sharedInterestsOnly !== committed.sharedInterestsOnly,
    [draft, committed],
  );

  function apply() {
    // Non-premium users can only change the age range; ignore gated changes
    // (gender / countries / shared-interests are all premium-only).
    const next: MatchFilters = premiumLocked
      ? { ...committed, ageMin: draft.ageMin, ageMax: draft.ageMax }
      : draft;
    setFilters(next);
    close();
  }

  function resetAll() {
    setDraft(DEFAULT_FILTERS);
    reset();
  }

  return (
    <>
      <DialogHeader>
        <span className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/50 px-2.5 py-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          {t('modals.filters.eyebrow')}
        </span>
        <DialogTitle>{t('modals.filters.title')}</DialogTitle>
        <DialogDescription>
          {t('modals.filters.description')}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-6">
        {/* Gender preference */}
        <fieldset>
          <div className="mb-2 flex items-center justify-between">
            <legend className="text-sm font-medium text-foreground">{t('modals.filters.genderLegend')}</legend>
            {premiumLocked && (
              <Badge variant="warning" size="sm" className="gap-1">
                <Crown className="h-3 w-3" /> {t('modals.filters.premiumBadge')}
              </Badge>
            )}
          </div>
          <div
            role="radiogroup"
            aria-label={t('modals.filters.genderAria')}
            className={cn('grid grid-cols-3 gap-2', premiumLocked && 'opacity-60')}
          >
            {GENDERS.map((g) => {
              const Icon = g.icon;
              const selected = draft.gender === g.value;
              return (
                <button
                  key={g.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={premiumLocked && g.value !== 'any'}
                  onClick={() => setDraft((d) => ({ ...d, gender: g.value }))}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-sm font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'disabled:cursor-not-allowed',
                    selected
                      ? 'border-accent-muted bg-accent-soft text-accent'
                      : 'border-border bg-card/40 text-muted-foreground hover:border-border-strong hover:text-foreground',
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {g.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Age range */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label htmlFor="age-range">{t('modals.filters.ageLabel')}</Label>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {draft.ageMin}–{draft.ageMax}
              {draft.ageMax >= AGE_MAX ? '+' : ''}
            </span>
          </div>
          <Slider
            id="age-range"
            min={AGE_MIN}
            max={AGE_MAX}
            step={1}
            minStepsBetweenThumbs={1}
            value={[draft.ageMin, draft.ageMax]}
            onValueChange={([min, max]) =>
              setDraft((d) => ({ ...d, ageMin: min ?? AGE_MIN, ageMax: max ?? AGE_MAX }))
            }
            aria-label={t('modals.filters.ageRangeAria')}
            className="mt-3"
          />
        </div>

        {/* Countries */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label htmlFor="filter-countries">{t('modals.filters.countriesLabel')}</Label>
            {premiumLocked && (
              <Badge variant="warning" size="sm" className="gap-1">
                <Crown className="h-3 w-3" /> {t('modals.filters.premiumBadge')}
              </Badge>
            )}
          </div>
          <CountrySelect
            id="filter-countries"
            value={draft.countries}
            onChange={(countries: CountryCode[]) => setDraft((d) => ({ ...d, countries }))}
            placeholder={t('modals.filters.countriesPlaceholder')}
            maxSelections={50}
            disabled={premiumLocked}
            aria-label={t('modals.filters.countriesAria')}
          />
          {!premiumLocked && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t('modals.filters.countriesHint')}
            </p>
          )}
        </div>

        {/* Shared interests (premium) */}
        <div
          className={cn(
            'flex items-start justify-between gap-3 rounded-xl border border-border bg-card/30 p-3.5',
            premiumLocked && 'opacity-60',
          )}
        >
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <Label htmlFor="filter-shared-interests" className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-[var(--color-neon-violet)]" aria-hidden="true" />
                {t('modals.filters.sharedInterestsLabel')}
              </Label>
              {premiumLocked && (
                <Badge variant="warning" size="sm" className="gap-1">
                  <Crown className="h-3 w-3" /> {t('modals.filters.premiumBadge')}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('modals.filters.sharedInterestsHint')}
            </p>
          </div>
          <Switch
            id="filter-shared-interests"
            checked={!premiumLocked && draft.sharedInterestsOnly}
            disabled={premiumLocked}
            onCheckedChange={(checked) =>
              setDraft((d) => ({ ...d, sharedInterestsOnly: checked }))
            }
            aria-label={t('modals.filters.sharedInterestsAria')}
            className="mt-0.5 shrink-0"
          />
        </div>

        {/* Premium upsell for gated controls */}
        {premiumLocked && (
          <button
            type="button"
            onClick={() => open('premium', { reason: t('modals.filters.upsellReason') })}
            className="flex w-full items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-left transition-colors hover:bg-warning/15"
          >
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
              <Sparkles className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <span className="text-sm">
              <span className="font-medium text-foreground">{t('modals.filters.upsellTitle')}</span>
              <span className="block text-muted-foreground">
                {t('modals.filters.upsellDescription')}
              </span>
            </span>
          </button>
        )}
      </div>

      <DialogFooter className="sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          leadingIcon={<RotateCcw className="h-4 w-4" />}
          onClick={resetAll}
        >
          {t('modals.filters.reset')}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            {t('modals.filters.cancel')}
          </Button>
          <Button type="button" variant="primary" onClick={apply} disabled={!isDirty}>
            {t('modals.filters.apply')}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
