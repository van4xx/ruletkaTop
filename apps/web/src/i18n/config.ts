/**
 * Locale configuration — the single source of truth for which languages the web
 * app supports and how the active locale is persisted.
 *
 * The app uses next-intl WITHOUT locale-based routing: there are no `/en` route
 * prefixes. The active locale is stored in a plain (non-httpOnly) cookie so the
 * server can read it in `getRequestConfig` and a client switcher can set it.
 *
 * This module is import-safe from BOTH server and client code (no server-only
 * imports), so the `LanguageSwitcher`, the request config, and the cookie action
 * can all share these constants.
 */

/** Every supported locale. Order defines the switcher's cycle order. */
export const LOCALES = ['ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** The product is Russian-first: `ru` is the default + the fallback for any
 *  missing message. */
export const DEFAULT_LOCALE: Locale = 'ru';

/** Cookie the active locale is persisted under (read server-side in request.ts). */
export const LOCALE_COOKIE = 'locale';

/** One year — the locale is a sticky preference, refreshed on each switch. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Display metadata for each locale (used by the switcher + any locale picker). */
export const LOCALE_LABELS: Record<Locale, { native: string; english: string; flag: string }> = {
  ru: { native: 'Русский', english: 'Russian', flag: '🇷🇺' },
  en: { native: 'English', english: 'English', flag: '🇬🇧' },
};
