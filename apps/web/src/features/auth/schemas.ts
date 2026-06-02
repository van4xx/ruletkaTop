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
export const registerFormSchema = baseRegisterSchema
  .extend({
    gender: genderSchema,
    // Required in the form (a default is supplied via RHF `defaultValues`), so
    // the resolved input/output types stay aligned for react-hook-form.
    locale: localeSchema,
    birthDate: z
      .string()
      .min(1, 'Укажите дату рождения')
      .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Некорректная дата')
      .refine((v) => new Date(v).getTime() <= Date.now(), 'Дата не может быть в будущем')
      .refine((v) => ageFromBirthDate(v) >= MIN_AGE, `Регистрация доступна с ${MIN_AGE} лет`),
  });
export type RegisterFormValues = z.infer<typeof registerFormSchema>;

/** Gender options for the segmented control (Russian labels). */
export const GENDER_OPTIONS = [
  { value: 'female', label: 'Женский' },
  { value: 'male', label: 'Мужской' },
  { value: 'other', label: 'Другое' },
] as const satisfies ReadonlyArray<{ value: z.infer<typeof genderSchema>; label: string }>;

/** Locale options for register / settings. */
export const LOCALE_OPTIONS = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
] as const satisfies ReadonlyArray<{ value: z.infer<typeof localeSchema>; label: string }>;
