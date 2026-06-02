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
  };
});
