'use client';

/**
 * Tasteful read-only interest chips for the profile hero + the "О себе" tab.
 *
 * Renders nothing when there are no interests (callers don't need to guard).
 * Each chip is a small neon-tinted pill; an optional `highlight` set (e.g. the
 * interests shared with the current viewer) gets a brighter aurora treatment so
 * common ground stands out. `max` truncates with a subtle "+N" overflow chip.
 */
import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { normalizeInterest, SUGGESTED_INTERESTS } from '@/features/profile/interests';

/** Map a normalized stored value back to its suggestion key, when curated. */
const KEY_BY_NORMALIZED_VALUE = new Map(
  SUGGESTED_INTERESTS.map((s) => [normalizeInterest(s.value), s.key]),
);

export function InterestChips({
  interests,
  /** Interests to visually highlight (compared case-insensitively). */
  highlight,
  /** Cap the number of chips shown; the rest collapse into a "+N" pill. */
  max,
  /** Show a small leading "Интересы" eyebrow with a sparkle icon. */
  withLabel = false,
  className,
}: {
  interests: readonly string[];
  highlight?: readonly string[];
  max?: number;
  withLabel?: boolean;
  className?: string;
}) {
  const t = useTranslations('profile');
  if (!interests || interests.length === 0) return null;

  const shown = typeof max === 'number' ? interests.slice(0, max) : interests;
  const overflow = interests.length - shown.length;
  const highlightKeys = new Set((highlight ?? []).map(normalizeInterest));

  /** Localized label for a stored tag — curated tags get a catalogue label,
   *  free-form tags fall back to the raw (user-typed) value. */
  const labelFor = (tag: string): string => {
    const key = KEY_BY_NORMALIZED_VALUE.get(normalizeInterest(tag));
    return key ? t(`interests.${key}`) : tag;
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {withLabel && (
        <span className="inline-flex items-center gap-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
          <Sparkles className="h-3 w-3 text-[var(--color-neon-violet)]" aria-hidden="true" />
          {t('header.interestsLabel')}
        </span>
      )}
      {shown.map((tag) => {
        const isShared = highlightKeys.has(normalizeInterest(tag));
        return (
          <span
            key={tag}
            className={cn(
              'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors',
              isShared
                ? 'bg-aurora text-accent-foreground ring-transparent shadow-glow'
                : 'bg-[var(--color-neon-violet)]/10 text-foreground/90 ring-[var(--color-neon-violet)]/25',
            )}
          >
            {labelFor(tag)}
          </span>
        );
      })}
      {overflow > 0 && (
        <span className="inline-flex items-center rounded-full bg-card/55 px-2.5 py-1 text-xs font-medium text-muted-foreground ring-1 ring-border/60">
          +{overflow}
        </span>
      )}
    </div>
  );
}
