import type { PaymentStatus } from '@ruletka/shared-types';

/**
 * Provider-agnostic PaymentProvider port.
 *
 * Encapsulates the money-MOVING surface every payment integration must expose
 * so the rest of the platform (payments.service, premium.service, admin-refund,
 * the {@link PaymentsCancelPort} used by users/moderation teardown, …) can stay
 * fully decoupled from any specific provider. CloudPayments was the original
 * implementation; the new {@link TbankProvider} is the default — both implement
 * this same shape.
 *
 * ── Currency unit ──────────────────────────────────────────────────────────
 * The provider port speaks **kopecks** (integer minor units of RUB). Provider
 * adapters are responsible for converting to/from whatever the upstream API
 * expects (CloudPayments uses major-unit floats — roubles; T-Bank uses minor-
 * unit integers — kopecks). Callers MUST pass integers; non-integer or
 * negative amounts are rejected by adapters with a typed error.
 *
 * ── Idempotency ────────────────────────────────────────────────────────────
 * The platform keys its idempotency on `orderId` (the legacy `invoiceId`). The
 * adapter receives it on createCheckout and MUST surface the same id back in
 * the response so the payments service can pair the Payment row with the
 * provider's transaction (and recognise a redelivered webhook).
 *
 * ── Failure mode ───────────────────────────────────────────────────────────
 * Methods throw on hard provider failure. Adapters MUST also expose
 * {@link PaymentProvider.isConfigured} so a teardown helper can `if(!configured)
 * return` instead of throwing a NotConfigured exception inside best-effort code
 * (matches the original CloudPaymentsClient semantics).
 */
export interface PaymentProvider {
  /** Stable identifier for the active provider (`tbank`, `cloudpayments`). */
  readonly providerName: PaymentProviderName;

  /** Whether outbound calls are possible (credentials present). */
  isConfigured(): boolean;

  /**
   * Begin a hosted-checkout payment. Returns the params the client uses to
   * COMPLETE the payment — for T-Bank this is a `paymentUrl` to redirect the
   * browser to; for CloudPayments it is a `paymentUrl` of empty string + the
   * widget params on the legacy code path (callers detect 'tbank' by env and
   * use the URL exclusively for new flows). `orderId` is echoed back.
   */
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;

  /**
   * Best-effort cancel of a recurring subscription / "rebill" upstream by its
   * provider-side id. MUST be idempotent on the post-condition: cancelling an
   * already-cancelled / unknown subscription resolves cleanly.
   */
  cancelSubscription(input: { providerSubscriptionId: string }): Promise<void>;

  /**
   * Refund a completed payment by its provider transaction id. `amountKopecks`
   * is optional — when omitted the adapter requests a full refund (the caller
   * is expected to know the original amount and pass it explicitly to keep
   * upstream + ledger consistent).
   */
  refund(input: {
    providerPaymentId: string;
    amountKopecks?: number;
  }): Promise<{ success: boolean }>;

  /** Read the upstream status of a payment for audit / reconciliation. */
  getState(input: { providerPaymentId: string }): Promise<{ status: PaymentStatus | 'unknown' }>;

  /**
   * Charge an existing recurring token / RebillId server-side. Optional — only
   * needed for renewal flows that are driven by US (T-Bank: explicit `Charge`
   * call). CloudPayments' renewals are PROVIDER-driven (Recurrent webhook) so
   * the adapter implements it but never has it called from the rest of the
   * system; tests still exercise the contract.
   */
  chargeRecurring?(input: {
    rebillId: string;
    amountKopecks: number;
    orderId: string;
    description?: string;
  }): Promise<{ providerPaymentId: string; status: PaymentStatus | 'unknown' }>;
}

/** Active provider name. Default in the env is `tbank`. */
export type PaymentProviderName = 'tbank' | 'cloudpayments';

/** Server-side recurrent descriptor passed to {@link PaymentProvider.createCheckout}. */
export interface CheckoutRecurrentSpec {
  /** Whether this checkout should also create a recurring token / rebill. */
  enabled: boolean;
  /** Days between charges (e.g. 30 → monthly). Used for the upstream descriptor. */
  intervalDays?: number;
}

/** Input to {@link PaymentProvider.createCheckout}. */
export interface CreateCheckoutInput {
  /** What is being bought; the adapter may surface this in the receipt/description. */
  purpose: 'coins' | 'premium';
  /** Beneficiary user id (echoed back to us in the webhook for fulfilment). */
  userId: string;
  /** Amount in INTEGER kopecks (always >= 0; non-integer is rejected). */
  amountKopecks: number;
  /** ISO-4217 currency (`RUB`). */
  currency: string;
  /** Recurrent descriptor (premium subscriptions). */
  recurrent?: CheckoutRecurrentSpec;
  /** Stable, idempotent order id (the platform's invoiceId). */
  orderId: string;
  /** Human-readable description shown on the widget / receipt. */
  description: string;
  /** Where the provider should redirect the user after a successful pay. */
  successUrl?: string;
  /** Where the provider should redirect the user after a failed pay. */
  failUrl?: string;
  /**
   * Free-form server-trusted payload (e.g. `{purpose,plan,packageCode,userId}`).
   * Adapters MAY embed this verbatim so the webhook carries it back unchanged
   * (T-Bank: `DATA` map; CloudPayments: `Data` JSON string). The platform
   * NEVER re-trusts client input — only this server-minted envelope.
   */
  data?: Record<string, string>;
}

/** Result of {@link PaymentProvider.createCheckout}. */
export interface CreateCheckoutResult {
  /** URL the client should `window.location.href = …` to (T-Bank PaymentURL). */
  paymentUrl: string;
  /** Provider-issued payment id (T-Bank `PaymentId`; CloudPayments has none yet). */
  providerPaymentId: string | null;
  /** Echo of the platform `orderId` — same value the caller passed in. */
  orderId: string;
}

/** Internal DI tokens kept narrow so test wires never accidentally rebind them. */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
