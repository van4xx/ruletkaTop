/**
 * Curated interest catalogue for the onboarding flow. Purely a UX aid for now:
 * the profile contract (`updateProfileSchema`) does not yet have an `interests`
 * field, so these are collected client-side. See the page's note to the
 * integrator about adding a backend `interests` field.
 */
export interface InterestOption {
  key: string;
  /** `misc.onboarding.*` key for the interest label. */
  labelKey: string;
  emoji: string;
}

export const INTERESTS: readonly InterestOption[] = [
  { key: 'music', labelKey: 'onboarding.interestMusic', emoji: '🎧' },
  { key: 'travel', labelKey: 'onboarding.interestTravel', emoji: '✈️' },
  { key: 'games', labelKey: 'onboarding.interestGames', emoji: '🎮' },
  { key: 'movies', labelKey: 'onboarding.interestMovies', emoji: '🎬' },
  { key: 'sport', labelKey: 'onboarding.interestSport', emoji: '⚽' },
  { key: 'art', labelKey: 'onboarding.interestArt', emoji: '🎨' },
  { key: 'tech', labelKey: 'onboarding.interestTech', emoji: '💻' },
  { key: 'food', labelKey: 'onboarding.interestFood', emoji: '🍜' },
  { key: 'books', labelKey: 'onboarding.interestBooks', emoji: '📚' },
  { key: 'languages', labelKey: 'onboarding.interestLanguages', emoji: '🗣️' },
  { key: 'photo', labelKey: 'onboarding.interestPhoto', emoji: '📷' },
  { key: 'nature', labelKey: 'onboarding.interestNature', emoji: '🌿' },
  { key: 'fashion', labelKey: 'onboarding.interestFashion', emoji: '👗' },
  { key: 'science', labelKey: 'onboarding.interestScience', emoji: '🔬' },
  { key: 'pets', labelKey: 'onboarding.interestPets', emoji: '🐾' },
  { key: 'dance', labelKey: 'onboarding.interestDance', emoji: '💃' },
] as const;
