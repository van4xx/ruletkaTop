import { z } from 'zod';
import {
  countryCodeSchema,
  genderSchema,
  localeSchema,
  objectIdSchema,
  roleSchema,
} from './common';

/**
 * Distinct character classes used by the password-strength floor:
 * lowercase, uppercase, digit, symbol.
 */
const PASSWORD_CLASSES: readonly RegExp[] = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];

/**
 * Validation messages on the shared schemas are STABLE i18n KEYS (e.g.
 * `validation.passwordMin`), NOT display copy. The web client resolves them via
 * `useTranslations('auth')` then `t(error.message)` (catalogs live under
 * `apps/web/messages/<locale>/auth.json` in the `validation` object), mirroring
 * how `birthDate` is already handled. Keep the validation LOGIC here; only the
 * message strings are keys.
 */
export const passwordSchema = z
  .string()
  .min(8, 'validation.passwordMin')
  .max(128, 'validation.passwordMax')
  // Strength floor (modern, passphrase-friendly): accept EITHER a long
  // passphrase (12+ chars, any composition) OR a shorter password that mixes at
  // least two distinct character classes. This rejects trivially weak secrets
  // like "12345678" / "password" while never penalising strong passphrases.
  .refine(
    (pw) => pw.length >= 12 || PASSWORD_CLASSES.filter((re) => re.test(pw)).length >= 2,
    'validation.passwordWeak',
  )
  // Reject a single character repeated ("aaaaaaaa", "11111111").
  .refine((pw) => !/^(.)\1+$/.test(pw), 'validation.passwordRepeated');

export const nicknameSchema = z
  .string()
  .min(3, 'validation.nicknameMin')
  .max(24, 'validation.nicknameMax')
  .regex(/^[a-zA-Z0-9_]+$/, 'validation.nicknameChars');

export const registerSchema = z.object({
  email: z.string().email('validation.email'),
  password: passwordSchema,
  nickname: nicknameSchema,
  gender: genderSchema,
  /** ISO date, `yyyy-mm-dd`. Age (18+) is derived & enforced server-side. */
  birthDate: z.string(),
  country: countryCodeSchema,
  locale: localeSchema.optional(),
  /**
   * Consent (152-ФЗ / GDPR): the user must accept the Terms of Service and
   * Privacy Policy to register. ADDITIVE + optional in the contract so existing
   * callers still type-check; the API rejects a registration unless this is
   * `true` (it records `acceptedTermsAt` / `acceptedPrivacyAt` server-side).
   */
  acceptedTerms: z.boolean().optional(),
  /**
   * Anti-bot CAPTCHA token (Cloudflare Turnstile / hCaptcha). ADDITIVE +
   * optional in the contract so existing callers type-check; the API verifies
   * it server-side when a CAPTCHA secret is configured (no-op in dev).
   */
  captchaToken: z.string().optional(),
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email('validation.email'),
  password: z.string().min(1, 'validation.passwordRequired'),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshDto = z.infer<typeof refreshSchema>;

// ── Email verification + password reset (token-based, emailed link) ──
export const requestPasswordResetSchema = z.object({ email: z.string().email('validation.email') });
export type RequestPasswordResetDto = z.infer<typeof requestPasswordResetSchema>;

export const resetPasswordSchema = z.object({
  /** Single-use, time-limited reset token from the emailed link. */
  token: z.string().min(16),
  password: passwordSchema,
});
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

export const verifyEmailSchema = z.object({ token: z.string().min(16) });
export type VerifyEmailDto = z.infer<typeof verifyEmailSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const authUserSchema = z.object({
  id: objectIdSchema,
  email: z.string().email(),
  role: roleSchema,
  nickname: nicknameSchema,
  isPremium: z.boolean(),
  /** Whether the email is confirmed (additive/optional; gates a "verify" banner). */
  emailVerified: z.boolean().optional(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authResponseSchema = z.object({
  user: authUserSchema,
  tokens: authTokensSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

/** Decoded JWT access-token payload. */
export const jwtPayloadSchema = z.object({
  sub: objectIdSchema,
  role: roleSchema,
  isPremium: z.boolean(),
});
export type JwtPayload = z.infer<typeof jwtPayloadSchema>;
