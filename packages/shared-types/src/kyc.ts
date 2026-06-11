import { z } from 'zod';

import { isoDateSchema, objectIdSchema } from './common';

/**
 * Age-verification provider name. The platform supports two real providers
 * (SumSub + Veriff) plus a `noop` fallback used in dev/CI when no credentials
 * are configured so onboarding keeps working.
 *
 * The active provider is picked at boot from the `KYC_PROVIDER` env. When
 * credentials for the chosen provider are missing the {@link KycService}
 * silently falls back to `noop` — which auto-approves in dev only and refuses
 * to issue real verifications in production. Mirrors the `PAYMENT_PROVIDER`
 * shape so swapping providers is an env-level change, not a code change.
 */
export const kycProviderNameSchema = z.enum(['sumsub', 'veriff', 'noop']);
export type KycProviderName = z.infer<typeof kycProviderNameSchema>;

/**
 * KYC verification lifecycle.
 *
 * - `pending`  — verification started, provider session opened, awaiting decision.
 * - `approved` — provider confirmed the user is 18+; Profile.ageVerifiedAt set.
 * - `rejected` — provider refused (under-age, fraud, document mismatch).
 * - `expired`  — provider session timed out without a decision; user can retry.
 */
export const kycStatusSchema = z.enum(['pending', 'approved', 'rejected', 'expired']);
export type KycStatus = z.infer<typeof kycStatusSchema>;

/**
 * Wire shape of a {@link KycVerification} row as returned by `GET /kyc/me`.
 *
 * `decisionMeta` is the verbatim provider decision blob (review answer + flags)
 * kept for audit; never trusted client-side and never used to authorise — the
 * `status` field is the only thing the rest of the platform reads.
 */
export const kycVerificationSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  provider: kycProviderNameSchema,
  status: kycStatusSchema,
  /** Provider-side applicant/session id (echo from the provider, unique per row). */
  externalId: z.string(),
  requestedAt: isoDateSchema,
  /** When the provider returned a terminal decision (`null` while pending). */
  decidedAt: isoDateSchema.nullable(),
  /** Provider decision details (free-form audit blob). */
  decisionMeta: z.record(z.string(), z.unknown()).nullable(),
});
export type KycVerification = z.infer<typeof kycVerificationSchema>;

/**
 * Response of `POST /kyc/start`. Carries the externally-hosted verification URL
 * the client opens in a NEW TAB (provider iframe lives off our origin) and the
 * timestamp at which the session expires — after which the user must retry.
 *
 * `expiresAt` is a unix millisecond timestamp (number) so the client can build
 * a Date without timezone ambiguity; mirrors the shape used by the wallet
 * idempotency layer for cross-language clients (web + mobile).
 */
export const kycStartResponseSchema = z.object({
  provider: kycProviderNameSchema,
  status: kycStatusSchema,
  externalId: z.string(),
  redirectUrl: z.string().url(),
  expiresAt: z.number().int().nonnegative(),
});
export type KycStartResponse = z.infer<typeof kycStartResponseSchema>;

/**
 * Public `GET /kyc/me` response. Either `null` (the user has never started
 * verification) or the latest {@link KycVerification} row plus a flat boolean
 * (`ageVerified`) the UI uses to render the "verified" state without having to
 * re-derive it from the status enum.
 */
export const kycMeResponseSchema = z.object({
  ageVerified: z.boolean(),
  verification: kycVerificationSchema.nullable(),
});
export type KycMeResponse = z.infer<typeof kycMeResponseSchema>;
