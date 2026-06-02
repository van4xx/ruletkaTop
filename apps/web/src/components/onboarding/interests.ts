/**
 * Curated interest catalogue for the onboarding flow. Purely a UX aid for now:
 * the profile contract (`updateProfileSchema`) does not yet have an `interests`
 * field, so these are collected client-side. See the page's note to the
 * integrator about adding a backend `interests` field.
 */
export interface InterestOption {
  key: string;
  label: string;
  emoji: string;
}

export const INTERESTS: readonly InterestOption[] = [
  { key: 'music', label: 'Музыка', emoji: '🎧' },
  { key: 'travel', label: 'Путешествия', emoji: '✈️' },
  { key: 'games', label: 'Игры', emoji: '🎮' },
  { key: 'movies', label: 'Кино и сериалы', emoji: '🎬' },
  { key: 'sport', label: 'Спорт', emoji: '⚽' },
  { key: 'art', label: 'Искусство', emoji: '🎨' },
  { key: 'tech', label: 'Технологии', emoji: '💻' },
  { key: 'food', label: 'Еда', emoji: '🍜' },
  { key: 'books', label: 'Книги', emoji: '📚' },
  { key: 'languages', label: 'Языки', emoji: '🗣️' },
  { key: 'photo', label: 'Фотография', emoji: '📷' },
  { key: 'nature', label: 'Природа', emoji: '🌿' },
  { key: 'fashion', label: 'Мода', emoji: '👗' },
  { key: 'science', label: 'Наука', emoji: '🔬' },
  { key: 'pets', label: 'Питомцы', emoji: '🐾' },
  { key: 'dance', label: 'Танцы', emoji: '💃' },
] as const;
