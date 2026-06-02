'use client';

/**
 * Matchmaking filters editor. Gender + country filters are PREMIUM-gated
 * (marked with a crown + disabled for non-premium users, who can still open the
 * dialog to discover the feature). The age range is free for everyone.
 *
 * Values are validated against the shared `matchFiltersSchema` on apply, so we
 * never emit an invalid `mm:join` payload.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Crown, SlidersHorizontal, Sparkles } from 'lucide-react';
import {
  Badge,
  Button,
  CountrySelect,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Label,
  Slider,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@ruletka/ui';
import { matchFiltersSchema, type CountryCode, type MatchFilters } from '@ruletka/shared-types';
import Link from 'next/link';
import { ROUTES } from '@/config/nav';
import { cn } from '@/lib/cn';

const AGE_MIN = 18;
const AGE_MAX = 100;

const GENDER_VALUES: MatchFilters['gender'][] = ['any', 'male', 'female'];

export interface FiltersDialogProps {
  value: MatchFilters;
  onApply: (next: MatchFilters) => void;
  isPremium: boolean;
  /** Disable opening (e.g. mid-call you may still allow it; default false). */
  disabled?: boolean;
  /** Render a custom trigger; defaults to an outline button with a badge. */
  trigger?: React.ReactNode;
}

function PremiumTag() {
  return (
    <Badge variant="aurora" size="sm" className="gap-1">
      <Crown className="h-3 w-3" aria-hidden="true" />
      Premium
    </Badge>
  );
}

const GENDER_LABEL_KEY: Record<MatchFilters['gender'], string> = {
  any: 'filters.genderAny',
  male: 'filters.genderMale',
  female: 'filters.genderFemale',
};

export function FiltersDialog({
  value,
  onApply,
  isPremium,
  disabled = false,
  trigger,
}: FiltersDialogProps) {
  const t = useTranslations('roulette');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MatchFilters>(value);

  // Resync the draft whenever the dialog opens or the source value changes.
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const activeCount =
    (value.gender !== 'any' ? 1 : 0) +
    (value.countries.length > 0 ? 1 : 0) +
    (value.ageMin !== AGE_MIN || value.ageMax !== AGE_MAX ? 1 : 0) +
    (value.sharedInterestsOnly ? 1 : 0);

  function apply() {
    // Non-premium can't enable premium-gated toggles (the control is disabled),
    // but guard here too so a stale draft can never leak a premium filter.
    const safe: MatchFilters = {
      ...draft,
      sharedInterestsOnly: isPremium ? draft.sharedInterestsOnly : false,
    };
    const parsed = matchFiltersSchema.safeParse(safe);
    if (parsed.success) {
      onApply(parsed.data);
    } else {
      // Coerce a safe value (clamp) rather than rejecting silently.
      onApply({
        gender: safe.gender,
        ageMin: Math.min(safe.ageMin, safe.ageMax),
        ageMax: Math.max(safe.ageMin, safe.ageMax),
        countries: safe.countries.slice(0, 50),
        sharedInterestsOnly: safe.sharedInterestsOnly,
      });
    }
    setOpen(false);
  }

  function reset() {
    setDraft({
      gender: 'any',
      ageMin: AGE_MIN,
      ageMax: AGE_MAX,
      countries: [],
      sharedInterestsOnly: false,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="glass" size="md" disabled={disabled} className="gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            {t('filters.trigger')}
            {activeCount > 0 && (
              <Badge variant="accent" size="sm" className="ml-0.5 tabular-nums">
                {activeCount}
              </Badge>
            )}
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('filters.title')}</DialogTitle>
          <DialogDescription>{t('filters.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Gender (premium) */}
          <fieldset
            className={cn('space-y-2.5', !isPremium && 'opacity-60')}
            disabled={!isPremium}
          >
            <div className="flex items-center justify-between">
              <Label>{t('filters.genderLabel')}</Label>
              {!isPremium && <PremiumTag />}
            </div>
            <div
              role="radiogroup"
              aria-label={t('filters.genderLabel')}
              className="grid grid-cols-3 gap-2"
            >
              {GENDER_VALUES.map((value) => {
                const selected = draft.gender === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={!isPremium}
                    onClick={() => setDraft((d) => ({ ...d, gender: value }))}
                    className={cn(
                      'rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      selected
                        ? 'border-transparent bg-aurora text-accent-foreground shadow-glow'
                        : 'border-border bg-card/40 text-muted-foreground hover:text-foreground hover:bg-card/70',
                      !isPremium && 'cursor-not-allowed',
                    )}
                  >
                    {t(GENDER_LABEL_KEY[value])}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* Age range (free) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label>{t('filters.ageLabel')}</Label>
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {draft.ageMin}–{draft.ageMax}
              </span>
            </div>
            <Slider
              min={AGE_MIN}
              max={AGE_MAX}
              step={1}
              value={[draft.ageMin, draft.ageMax]}
              onValueChange={(vals: number[]) => {
                const [lo, hi] = vals;
                setDraft((d) => ({
                  ...d,
                  ageMin: Math.min(lo ?? AGE_MIN, hi ?? AGE_MAX),
                  ageMax: Math.max(lo ?? AGE_MIN, hi ?? AGE_MAX),
                }));
              }}
              showValues
              formatValue={(v) => `${v}`}
              aria-label={t('filters.ageRangeAriaLabel')}
              className="pt-1"
            />
          </div>

          {/* Countries (premium) */}
          <div className={cn('space-y-2.5', !isPremium && 'opacity-60')}>
            <div className="flex items-center justify-between">
              <Label htmlFor="filter-countries">{t('filters.countriesLabel')}</Label>
              {!isPremium && <PremiumTag />}
            </div>
            {isPremium ? (
              <CountrySelect
                id="filter-countries"
                value={draft.countries}
                onChange={(codes: CountryCode[]) =>
                  setDraft((d) => ({ ...d, countries: codes }))
                }
                placeholder={t('filters.anyCountry')}
                maxSelections={50}
                aria-label={t('filters.countriesAriaLabel')}
              />
            ) : (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      aria-disabled
                      className="flex min-h-11 w-full cursor-not-allowed items-center rounded-xl border border-border bg-input/30 px-3 text-sm text-muted-foreground"
                    >
                      {t('filters.anyCountry')}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>{t('filters.availableInPremium')}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {/* Shared interests (premium) */}
          <div
            className={cn(
              'flex items-start justify-between gap-3 rounded-xl border border-border bg-card/30 p-3.5',
              !isPremium && 'opacity-60',
            )}
          >
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="filter-shared-interests" className="flex items-center gap-1.5">
                  <Sparkles
                    className="h-4 w-4 text-[var(--color-neon-violet)]"
                    aria-hidden="true"
                  />
                  {t('filters.sharedInterestsLabel')}
                </Label>
                {!isPremium && <PremiumTag />}
              </div>
              <p className="text-xs text-muted-foreground">{t('filters.sharedInterestsHint')}</p>
            </div>
            <Switch
              id="filter-shared-interests"
              checked={isPremium && draft.sharedInterestsOnly}
              disabled={!isPremium}
              onCheckedChange={(checked) =>
                setDraft((d) => ({ ...d, sharedInterestsOnly: checked }))
              }
              aria-label={t('filters.sharedInterestsLabel')}
              className="mt-0.5 shrink-0"
            />
          </div>

          {!isPremium && (
            <Link
              href={ROUTES.top}
              className="flex items-center justify-center gap-2 rounded-xl border border-[var(--color-neon-violet)]/40 bg-[var(--color-neon-violet)]/10 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-[var(--color-neon-violet)]/20"
            >
              <Crown className="h-4 w-4 text-[var(--color-neon-magenta)]" />
              {t('filters.unlockWithPremium')}
            </Link>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={reset}>
            {t('filters.reset')}
          </Button>
          <Button variant="primary" onClick={apply}>
            {t('filters.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
