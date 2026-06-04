'use client';

/**
 * Resolve a react-hook-form field error into localized copy.
 *
 * The shared zod schemas (`@ruletka/shared-types`) and the client form schemas
 * (`./schemas`) set every validation message to a STABLE i18n KEY under the
 * `auth.validation.*` namespace (e.g. `validation.email`, `validation.passwordWeak`,
 * `validation.birthTooYoung`) instead of display text. This hook maps such a key
 * through `useTranslations('auth')` → friendly ru/en copy, interpolating
 * `{minAge}` for the age-gate messages.
 *
 * Anything that is NOT one of our known keys (e.g. a server-set message, or a
 * one-off literal) is passed through untouched, and `undefined` stays `undefined`
 * (no error to show). This is the single resolver the auth forms use for every
 * field error, so localization stays consistent and DRY.
 */
import { useTranslations } from 'next-intl';
import { MIN_AGE } from './schemas';

/** Every stable `validation.*` key the auth schemas can emit. Keep in sync with
 *  `apps/web/messages/<locale>/auth.json → validation` and the schema messages. */
const VALIDATION_KEYS = new Set([
  'validation.birthRequired',
  'validation.birthInvalid',
  'validation.birthFuture',
  'validation.birthTooYoung',
  'validation.email',
  'validation.passwordRequired',
  'validation.passwordMin',
  'validation.passwordMax',
  'validation.passwordWeak',
  'validation.passwordRepeated',
  'validation.nicknameMin',
  'validation.nicknameMax',
  'validation.nicknameChars',
  'validation.countryRequired',
  'validation.countryInvalid',
]);

/**
 * Returns a resolver `(message) => localized | undefined`. Pass it a RHF
 * `errors.<field>?.message`; it translates known `validation.*` keys and leaves
 * everything else as-is.
 */
export function useFieldError(): (message: string | undefined) => string | undefined {
  const t = useTranslations('auth');
  return (message) => {
    if (!message) return undefined;
    if (VALIDATION_KEYS.has(message)) return t(message, { minAge: MIN_AGE });
    return message;
  };
}
