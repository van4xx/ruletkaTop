import { cookies } from 'next/headers';
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES } from './config';
import { loadMessages } from './messages';

/**
 * Per-request next-intl configuration (App Router, NO locale routing).
 *
 * The active locale comes from the `locale` cookie (set by the LanguageSwitcher
 * via a server action). An unknown/absent cookie falls back to the default
 * locale, so first-time visitors get the Russian-first product. Messages are the
 * merged namespace dictionary for the resolved locale.
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const requested = store.get(LOCALE_COOKIE)?.value;
  const locale = hasLocale(LOCALES, requested) ? requested : DEFAULT_LOCALE;

  return {
    locale,
    messages: await loadMessages(locale),
    // Pin a single timestamp + an explicit time zone PER REQUEST so date
    // formatting (notably `useFormatter().relativeTime` / `format.relativeTime`
    // in the settings → devices "active sessions" list) resolves from this
    // shared config instead of next-intl's per-render ENVIRONMENT_FALLBACK
    // (which logs a dev warning and risks server/client hydration drift).
    //
    // `now` is captured once here so every formatter in the request shares the
    // same reference point — this is exactly next-intl's "global now" contract,
    // now made explicit rather than implicit. `timeZone` is fixed to Moscow,
    // matching the Russian-first product (no per-user TZ preference is stored).
    now: new Date(),
    timeZone: 'Europe/Moscow',
  };
});
