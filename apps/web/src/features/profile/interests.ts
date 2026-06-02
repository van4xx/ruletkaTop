/**
 * Interest tags — shared constants + helpers for the interests editor, the
 * profile chips, and the roulette "shared interests" matching.
 *
 * The contract (`@ruletka/shared-types`) bounds interests to ≤10 tags, each a
 * 1–24 char string. We mirror those limits here so the UI never produces an
 * invalid `updateProfile` / `mm:join` payload. Tags are normalised (trimmed,
 * lower-cased, collapsed whitespace) for de-duplication and for comparing two
 * users' interests when deciding whether they share one.
 */

/** Max number of interest tags a profile may hold (mirrors the contract). */
export const MAX_INTERESTS = 10;
/** Max length of a single interest tag (mirrors the contract). */
export const MAX_INTEREST_LEN = 24;

/**
 * A curated interest suggestion: a stable {@link SuggestedInterest.key} used to
 * resolve a localized label (`profile.interests.<key>`) and the canonical
 * {@link SuggestedInterest.value} that is actually stored on the profile and
 * sent to the API. The value stays the Russian word for backward compatibility
 * with existing profiles and the matchmaking "shared interests" comparison.
 */
export interface SuggestedInterest {
  /** Stable identifier for the localized label (`profile.interests.<key>`). */
  key: string;
  /** Canonical stored value (sent to the API; never localized). */
  value: string;
}

/**
 * Curated suggestion set offered as quick-add chips in the editor. Free-form
 * tags are still allowed — these are just a tasteful, on-brand starting palette.
 * The stored `value` is the Russian word (kept stable for the API + matching);
 * the `key` resolves a localized label via the message catalogue.
 */
export const SUGGESTED_INTERESTS: readonly SuggestedInterest[] = [
  { key: 'music', value: 'музыка' },
  { key: 'games', value: 'игры' },
  { key: 'travel', value: 'путешествия' },
  { key: 'sport', value: 'спорт' },
  { key: 'movies', value: 'кино' },
  { key: 'art', value: 'искусство' },
  { key: 'books', value: 'книги' },
  { key: 'tech', value: 'технологии' },
  { key: 'fashion', value: 'мода' },
  { key: 'food', value: 'еда' },
  { key: 'photography', value: 'фотография' },
  { key: 'anime', value: 'аниме' },
  { key: 'dancing', value: 'танцы' },
  { key: 'nature', value: 'природа' },
  { key: 'science', value: 'наука' },
  { key: 'humor', value: 'юмор' },
  { key: 'programming', value: 'программирование' },
  { key: 'animals', value: 'животные' },
  { key: 'fitness', value: 'фитнес' },
  { key: 'languages', value: 'языки' },
] as const;

/** Normalise a tag for comparison/de-dup: trim, collapse spaces, lower-case. */
export function normalizeInterest(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

/** Clean + clamp a raw tag to the contract bounds (empty string if invalid). */
export function sanitizeInterest(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_INTEREST_LEN);
}

/**
 * Add `raw` to `list`, de-duplicating case-insensitively and enforcing the max
 * count. Returns the original list (unchanged reference) when the tag is empty,
 * a duplicate, or the list is already full — so callers can detect "no-op".
 */
export function addInterest(list: string[], raw: string): string[] {
  const value = sanitizeInterest(raw);
  if (!value || list.length >= MAX_INTERESTS) return list;
  const key = normalizeInterest(value);
  if (list.some((t) => normalizeInterest(t) === key)) return list;
  return [...list, value];
}

/** Remove a tag by value (case-insensitive). */
export function removeInterest(list: string[], raw: string): string[] {
  const key = normalizeInterest(raw);
  return list.filter((t) => normalizeInterest(t) !== key);
}

/**
 * The set of interests shared by two users (case-insensitive), preserving the
 * casing from `a`. Returns `[]` when either side has none — so a user with no
 * interests simply never "shares" one (matching stays additive/optional).
 */
export function sharedInterests(a: readonly string[], b: readonly string[]): string[] {
  if (!a.length || !b.length) return [];
  const bKeys = new Set(b.map(normalizeInterest));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of a) {
    const key = normalizeInterest(tag);
    if (bKeys.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}
