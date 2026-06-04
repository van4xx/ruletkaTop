'use client';

/**
 * Turn an unknown thrown value (from the api client / a mutation) into ONE
 * localized, user-friendly message. This is the single place that decides what a
 * user sees when something fails, so no screen ever leaks a raw
 * `TypeError: Failed to fetch`, a stack, or an untranslated validation key.
 *
 * Mapping (in priority order):
 *  - network failure (`ApiClientError.code === 'network'`, i.e. the request never
 *    reached the server) → `common.errors.network`
 *  - 5xx server failure → `common.errors.server`
 *  - any other failure → `common.errors.generic`
 *
 * We deliberately do NOT echo `error.message` from a 4xx body here: those bodies
 * carry stable validation KEYS (e.g. `email: validation.email`) or terse backend
 * strings, neither of which is presentable. Callers that have a nicer
 * status-specific message (e.g. login's "invalid credentials" on 401, register's
 * "already taken" on 409) should branch on `error.status` themselves BEFORE
 * falling back to this helper.
 */
import { useTranslations } from 'next-intl';
import { ApiClientError } from './api';

/** A minimal translator shape — satisfied by next-intl's `useTranslations`. */
type Translate = (key: string) => string;

/**
 * Pure mapper: given a translator scoped to the `common` namespace, return the
 * localized message for `error`. Exposed for non-hook call sites (and tests);
 * most components should use {@link useErrorMessage}.
 */
export function resolveErrorMessage(error: unknown, tCommon: Translate): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'network' || error.status === 0) return tCommon('errors.network');
    if (error.status >= 500) return tCommon('errors.server');
  }
  return tCommon('errors.generic');
}

/**
 * Hook returning a stable mapper from an unknown error to a localized message,
 * reading copy from the `common` namespace. Use in submit `catch`/`onError`
 * handlers and error banners.
 */
export function useErrorMessage(): (error: unknown) => string {
  const t = useTranslations('common');
  return (error: unknown) => resolveErrorMessage(error, t);
}
