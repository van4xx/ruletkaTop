/**
 * Client-side form schemas for auth.
 *
 * These re-use the canonical contract schemas from `@ruletka/shared-types`
 * (so the over-the-wire shape stays identical) and layer on the *client*
 * concerns the server can't express in a single field — most importantly the
 * 18+ age check on `birthDate`, which the API enforces server-side but which we
 * want to surface instantly in the form with a friendly message.
 */
import { z } from 'zod';
import {
  loginSchema as baseLoginSchema,
  registerSchema as baseRegisterSchema,
  requestPasswordResetSchema as baseRequestPasswordResetSchema,
  passwordSchema,
  genderSchema,
  localeSchema,
} from '@ruletka/shared-types';

/** Login form values — identical to the contract. */
export const loginFormSchema = baseLoginSchema;
export type LoginFormValues = z.infer<typeof loginFormSchema>;

/** "Forgot password" form — just the email, identical to the contract. */
export const forgotPasswordFormSchema = baseRequestPasswordResetSchema;
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordFormSchema>;

/**
 * "Reset password" form. The contract's `resetPasswordSchema` carries the
 * `token` (sourced from the URL, not a typed field), so the FORM only validates
 * the new `password` against the shared strength policy (`passwordSchema`). The
 * page merges the URL token back in before calling the API.
 */
export const resetPasswordFormSchema = z.object({ password: passwordSchema });
export type ResetPasswordFormValues = z.infer<typeof resetPasswordFormSchema>;

/** Minimum age, in years, to register. */
export const MIN_AGE = 18;

/** Returns whole years between `birthDate` (yyyy-mm-dd) and today. */
export function ageFromBirthDate(birthDate: string): number {
  const dob = new Date(birthDate);
  if (Number.isNaN(dob.getTime())) return NaN;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

/**
 * Register form values. Extends the contract with:
 *  - a parsable, not-in-the-future `birthDate`,
 *  - a hard 18+ gate (mirrors the server rule),
 *  - `locale` defaulted to `ru` (the product is Russian-first).
 */
/**
 * Birth-date validation messages are STABLE i18n keys (under `auth.validation.*`),
 * not display copy. The consuming form resolves them with
 * `useTranslations('auth')` → `t(error.message)`. The `${MIN_AGE}` interpolation
 * lives in the catalogue value (`{minAge}`), passed in at render time by the form.
 */
export const registerFormSchema = baseRegisterSchema.extend({
  gender: genderSchema,
  // Required in the form (a default is supplied via RHF `defaultValues`), so
  // the resolved input/output types stay aligned for react-hook-form.
  locale: localeSchema,
  birthDate: z
    .string()
    .min(1, 'validation.birthRequired')
    .refine((v) => !Number.isNaN(new Date(v).getTime()), 'validation.birthInvalid')
    .refine((v) => new Date(v).getTime() <= Date.now(), 'validation.birthFuture')
    .refine((v) => ageFromBirthDate(v) >= MIN_AGE, 'validation.birthTooYoung'),
  // Explicit consent (152-ФЗ / GDPR). The wire contract leaves `acceptedTerms`
  // optional for additivity, but the API REQUIRES it to be `true` — so the form
  // must collect it and we enforce it client-side (a ticked box) to mirror the
  // server rule and avoid a confusing 400 on submit.
  acceptedTerms: z.boolean().refine((v) => v === true, 'validation.acceptTerms'),
  // AGE-GATE LEVEL 1: explicit 18+ self-attestation, captured as a SEPARATE
  // checkbox under the Terms/Privacy consent. The contract leaves
  // `acceptedAdult` optional for additivity, but the API REQUIRES it to be
  // `true` (audited as `user.consent.adult` server-side). Enforced client-side
  // to mirror the server rule and avoid a confusing 400 on submit.
  acceptedAdult: z.boolean().refine((v) => v === true, 'validation.acceptAdult'),
});
export type RegisterFormValues = z.infer<typeof registerFormSchema>;

/**
 * Gender options for the segmented control. `labelKey` resolves under
 * `auth.genderOptions.*` via `useTranslations('auth')`; `label` is the Russian
 * fallback kept for consumers that read a plain string directly.
 */
export const GENDER_OPTIONS = [
  { value: 'female', label: 'Женский', labelKey: 'genderOptions.female' },
  { value: 'male', label: 'Мужской', labelKey: 'genderOptions.male' },
  { value: 'other', label: 'Другое', labelKey: 'genderOptions.other' },
] as const satisfies ReadonlyArray<{
  value: z.infer<typeof genderSchema>;
  label: string;
  labelKey: string;
}>;

/**
 * Locale options for register / settings. `labelKey` resolves under
 * `auth.localeOptions.*`; `label` is the native-name fallback.
 */
export const LOCALE_OPTIONS = [
  { value: 'ru', label: 'Русский', labelKey: 'localeOptions.ru' },
  { value: 'en', label: 'English', labelKey: 'localeOptions.en' },
] as const satisfies ReadonlyArray<{
  value: z.infer<typeof localeSchema>;
  label: string;
  labelKey: string;
}>;
