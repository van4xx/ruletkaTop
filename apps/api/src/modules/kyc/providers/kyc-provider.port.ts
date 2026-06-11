import type { KycProviderName, KycStatus } from '@ruletka/shared-types';

/** DI token the {@link KycService} injects to receive the active provider. */
export const KYC_PROVIDER = Symbol('KYC_PROVIDER');

/**
 * Outcome of a successful {@link KycProvider.startVerification}.
 *
 * `expiresAt` is a unix MILLISECOND timestamp (number) — kept primitive so the
 * controller can return it verbatim in {@link KycStartResponse}. Mirrors how
 * the payment provider port surfaces money-moving intents back to the platform.
 */
export interface StartVerificationResult {
  /** Provider applicant / session id (also the webhook idempotency key). */
  externalId: string;
  /** External URL the user is redirected to (provider iframe). */
  redirectUrl: string;
  /** Unix millis when the session expires (e.g. now + 1h). */
  expiresAt: number;
}

/** Outcome of a webhook parse — what the orchestrator persists. */
export interface ParseWebhookResult {
  externalId: string;
  status: KycStatus;
  /** Verbatim provider decision blob (for audit + the row). */
  decisionMeta: Record<string, unknown>;
  /**
   * Provider's decision timestamp from the webhook body. When present, used to
   * set `Profile.ageVerifiedAt` instead of a server-side clock — that way the
   * approval timestamp reflects the truth of the decision and the orchestrator
   * stays testable without a clock-mock dependency.
   *
   * Optional because the noop adapter doesn't drive a webhook flow. Real
   * providers (SumSub + Veriff) both include a decision timestamp in their
   * webhook bodies, so a real flow always carries this value.
   */
  decidedAt?: Date;
}

/** Outcome of a status poll (server-to-server, no webhook needed). */
export interface GetStatusResult {
  status: KycStatus;
  decisionMeta: Record<string, unknown> | null;
}

/**
 * Provider-agnostic KYC port.
 *
 * The platform exposes a thin orchestrator ({@link KycService}) that delegates
 * to ONE provider chosen by the `KYC_PROVIDER` env at boot. Adapters do the
 * REST + HMAC work; the service writes one {@link KycVerification} row, owns
 * idempotency on webhook redelivery, and on `approved` stamps
 * `Profile.ageVerifiedAt` so the matchmaking gate (opt-in via `KYC_REQUIRED`)
 * lets the user join the pool.
 *
 * Adapters MUST be configuration-tolerant: if credentials are missing,
 * {@link KycProvider.isConfigured} returns `false` and the orchestrator falls
 * back to the noop adapter — existing onboarding keeps working unaffected.
 */
export interface KycProvider {
  /** Stable identifier for the active provider. Mirrors `paymentProvider.providerName`. */
  readonly providerName: KycProviderName;

  /** Whether outbound calls are possible (credentials present). */
  isConfigured(): boolean;

  /**
   * Open a verification session for `userId`. Returns the URL the user is sent
   * to. `returnUrl` is forwarded to the provider so the iframe can redirect the
   * user back to our settings page when they finish (for UX only — the actual
   * decision lands via the webhook).
   */
  startVerification(userId: string, returnUrl: string): Promise<StartVerificationResult>;

  /**
   * Verify a webhook signature against `rawBody`, parse the body, and return
   * the canonical decision shape. Throws on signature mismatch — the controller
   * surfaces a 401 so the provider retries (most retry on non-2xx).
   *
   * `rawBody` is the EXACT bytes the provider signed — never reconstruct it
   * from `req.body`. The controller binds the raw-body buffer (Nest's
   * `{ rawBody: true }` bootstrap is already on in main.ts for the payments
   * webhook).
   */
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): Promise<ParseWebhookResult>;

  /** Server-to-server poll for the current state of an applicant. */
  getStatus(externalId: string): Promise<GetStatusResult>;
}
