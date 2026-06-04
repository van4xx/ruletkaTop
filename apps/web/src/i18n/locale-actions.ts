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
 *
 * Returns `true` when the cookie was written, `false` for an unsupported locale.
 * NEVER throws: a rejected Server Action would propagate out of the caller's
 * `startTransition` as an unhandled rejection and bubble to the root error
 * boundary (the full-screen "критическая ошибка" crash). Switching the UI
 * language must degrade gracefully, never tear down the app — so any failure to
 * write the cookie is swallowed here and reported as `false`.
 */
export async function setLocale(locale: Locale): Promise<boolean> {
  if (!LOCALES.includes(locale)) return false;
  try {
    const store = await cookies();
    store.set(LOCALE_COOKIE, locale, {
      path: '/',
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: 'lax',
    });
    return true;
  } catch {
    // Writing cookies can throw if invoked from a context Next.js considers
    // read-only. Don't surface it as a fatal error — the switch simply no-ops.
    return false;
  }
}
