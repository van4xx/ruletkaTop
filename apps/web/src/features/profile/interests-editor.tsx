'use client';

/**
 * Interest tag editor for the profile edit form.
 *
 * A controlled list of up to {@link MAX_INTERESTS} tags. Users can:
 *   • toggle from a curated suggestion palette ({@link SUGGESTED_INTERESTS}),
 *   • type a free-form tag and add it with Enter / "," / the + button,
 *   • remove a selected tag via its × or Backspace on an empty input.
 *
 * Tags are de-duplicated case-insensitively and clamped to the contract bounds.
 * Designed to read like the languages/gender chip rows already in the form
 * (dark neon, rounded pills), so it slots in seamlessly.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { Input, Label } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import {
  addInterest,
  MAX_INTERESTS,
  MAX_INTEREST_LEN,
  normalizeInterest,
  removeInterest,
  SUGGESTED_INTERESTS,
} from './interests';

/** Map a normalized stored value back to its suggestion key, when curated. */
const KEY_BY_NORMALIZED_VALUE = new Map(
  SUGGESTED_INTERESTS.map((s) => [normalizeInterest(s.value), s.key]),
);

export function InterestsEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations('profile');
  const [draft, setDraft] = useState('');
  const selected = value ?? [];
  const full = selected.length >= MAX_INTERESTS;
  const selectedKeys = new Set(selected.map(normalizeInterest));

  /** Localized label for a stored tag — curated tags get a catalogue label,
   *  free-form tags fall back to the raw (user-typed) value. */
  function labelFor(tag: string): string {
    const key = KEY_BY_NORMALIZED_VALUE.get(normalizeInterest(tag));
    return key ? t(`interests.${key}`) : tag;
  }

  function commitDraft() {
    const next = addInterest(selected, draft);
    if (next !== selected) onChange(next);
    setDraft('');
  }

  function toggle(tag: string) {
    if (selectedKeys.has(normalizeInterest(tag))) {
      onChange(removeInterest(selected, tag));
    } else {
      const next = addInterest(selected, tag);
      if (next !== selected) onChange(next);
    }
  }

  // Suggestions not already chosen — the quick-add palette.
  const suggestions = SUGGESTED_INTERESTS.filter(
    (s) => !selectedKeys.has(normalizeInterest(s.value)),
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <Label>{t('interestsEditor.label')}</Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {selected.length}/{MAX_INTERESTS}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('interestsEditor.hint', { max: MAX_INTERESTS })}
      </p>

      {/* Selected tags */}
      {selected.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {selected.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-neon-violet)]/15 py-1 pl-3 pr-1.5 text-sm font-medium text-foreground ring-1 ring-[var(--color-neon-violet)]/40"
            >
              {labelFor(tag)}
              <button
                type="button"
                onClick={() => onChange(removeInterest(selected, tag))}
                aria-label={t('interestsEditor.removeAria', { tag: labelFor(tag) })}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-[var(--color-neon-violet)]/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Free-form add */}
      <div className="mt-3 flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_INTEREST_LEN))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commitDraft();
            } else if (e.key === 'Backspace' && draft === '' && selected.length > 0) {
              // Quick remove of the last tag, like a typical tag input.
              onChange(selected.slice(0, -1));
            }
          }}
          placeholder={
            full ? t('interestsEditor.inputPlaceholderFull') : t('interestsEditor.inputPlaceholder')
          }
          disabled={full}
          maxLength={MAX_INTEREST_LEN}
          aria-label={t('interestsEditor.addAria')}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={commitDraft}
          disabled={full || draft.trim() === ''}
          aria-label={t('interestsEditor.addAria')}
          className={cn(
            'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            full || draft.trim() === ''
              ? 'cursor-not-allowed bg-card/40 text-muted-foreground ring-border/50'
              : 'bg-[var(--color-neon-cyan)]/15 text-foreground ring-[var(--color-neon-cyan)]/50 hover:bg-[var(--color-neon-cyan)]/25',
          )}
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* Curated suggestions */}
      {!full && suggestions.length > 0 && (
        <div className="mt-3">
          <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
            {t('interestsEditor.popularLabel')}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => toggle(s.value)}
                className="inline-flex items-center gap-1 rounded-full bg-card/50 px-3 py-1.5 text-sm font-medium text-foreground/85 ring-1 ring-border/60 transition-colors hover:bg-[var(--color-neon-violet)]/10 hover:text-foreground hover:ring-[var(--color-neon-violet)]/40"
              >
                <Plus className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                {t(`interests.${s.key}`)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
