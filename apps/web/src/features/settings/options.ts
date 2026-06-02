/**
 * Russian-labelled option lists for the settings selects, typed against the
 * shared enums so they can't drift from the contract.
 */
import type { Visibility } from '@ruletka/shared-types';

export const VISIBILITY_OPTIONS: ReadonlyArray<{ value: Visibility; label: string }> = [
  { value: 'everyone', label: 'Все' },
  { value: 'friends', label: 'Только друзья' },
  { value: 'nobody', label: 'Никто' },
] as const;
