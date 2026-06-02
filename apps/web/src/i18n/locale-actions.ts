'use server';

import { cookies } from 'next/headers';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALES, type Locale } from './config';

/**
 * Persists the chosen locale in a cookie. Called from the client
 * `LanguageSwitcher` inside a transition; the client then `router.refresh()`es so
 * the server re-renders with the new `getRequestConfig` locale.
 *
 * The value is validated against the supported-locale allow-list, so a tampered
 * client invocation can never write an arbitrary cookie value.
 */
export async function setLocale(locale: Locale): Promise<void> {
  if (!LOCALES.includes(locale)) return;
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
  });
}
