/**
 * Option lists for the settings selects, typed against the shared enums so they
 * can't drift from the contract. Labels are i18n keys (resolved in the consuming
 * components via `useTranslations('settings')`) rather than literal strings.
 */
import type { Visibility } from '@ruletka/shared-types';

export const VISIBILITY_OPTIONS: ReadonlyArray<{ value: Visibility; labelKey: string }> = [
  { value: 'everyone', labelKey: 'options.visibility.everyone' },
  { value: 'friends', labelKey: 'options.visibility.friends' },
  { value: 'nobody', labelKey: 'options.visibility.nobody' },
] as const;
