import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * OUTBOUND CloudPayments REST client — the money-MOVING counterpart to the
 * inbound webhooks. Where the webhooks react to charges CloudPayments already
 * made, this service is how WE initiate server-side actions against the
 * provider: confirm/charge a stored subscription token, cancel a recurring
 * subscription, and refund a completed payment.
 *
 * ── Auth ───────────────────────────────────────────────────────────────────
 * The CloudPayments REST API authenticates with HTTP Basic, username =
 * `CLOUDPAYMENTS_PUBLIC_ID`, password = `CLOUDPAYMENTS_API_SECRET` (the same
 * secret the inbound {@link CloudPaymentsSignatureGuard} HMAC-verifies with).
 * Both come from config; NEITHER is ever logged.
 *
 * ── Not-configured posture ──────────────────────────────────────────────────
 * If either key is unset, every method throws a clear
 * {@link ServiceUnavailableException} ("payments not configured") — it does NOT
 * crash boot. The service is always instantiable so the module graph wires up
 * in dev/CI without keys; only an actual outbound CALL fails, loudly and
 * catchably, mirroring how the inbound guard fails closed without a secret.
 *
 * ── Response shape ──────────────────────────────────────────────────────────
 * Every REST endpoint returns `{ Success: boolean, Message: string|null,
 * Model?: … }`. A non-2xx HTTP status OR `Success:false` is surfaced as an
 * error so callers never silently treat a declined/failed action as done.
 *
 * No card data is ever handled here — only opaque tokens, subscription ids and
 * provider transaction ids flow through.
 *
 * @see https://developers.cloudpayments.ru/#api
 */

/** CloudPayments REST base. Overridable via `CLOUDPAYMENTS_API_BASE` for tests. */
const DEFAULT_API_BASE = 'https://api.cloudpayments.ru';

/** Per-request timeout: the provider is normally fast; bound the tail. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Envelope every CloudPayments REST endpoint wraps its result in. */
interface CloudPaymentsApiResponse<TModel = unknown> {
  Success: boolean;
  Message: string | null;
  Model?: TModel;
}

/** `Model` of a successful token charge / confirm (subset we rely on). */
export interface CloudPaymentsTransactionModel {
  TransactionId?: number;
  Status?: string;
  /** Recurring token returned for stored-card charges. */
  Token?: string;
  Amount?: number;
}

/** Result of charging a stored subscription/recurring token. */
export interface ChargeTokenResult {
  transactionId: number | null;
  status: string | null;
  token: string | null;
}

/** Parameters to charge a previously-stored CloudPayments token. */
export interface ChargeTokenParams {
  /** Stored recurring-charge token (from a prior Pay/Recurrent notification). */
  token: string;
  /** Beneficiary account id (the user id we set as `AccountId` at checkout). */
  accountId: string;
  /** Amount in major units (roubles). */
  amount: number;
  /** ISO-4217 currency (RUB). */
  currency: string;
  /** Our invoice id, echoed back in the resulting webhook for reconciliation. */
  invoiceId: string;
  /** Human-readable description shown on the receipt. */
  description?: string;
}

@Injectable()
export class CloudPaymentsClient {
  private readonly logger = new Logger(CloudPaymentsClient.name);
  private readonly publicId: string;
  private readonly apiSecret: string;
  private readonly apiBase: string;

  constructor(private readonly config: ConfigService) {
    this.publicId = this.config.get<string>('CLOUDPAYMENTS_PUBLIC_ID', '').trim();
    this.apiSecret = this.config.get<string>('CLOUDPAYMENTS_API_SECRET', '').trim();
    this.apiBase = this.config
      .get<string>('CLOUDPAYMENTS_API_BASE', DEFAULT_API_BASE)
      .replace(/\/+$/, '');
  }

  /** Whether outbound calls are possible (both credentials present). */
  isConfigured(): boolean {
    return this.publicId.length > 0 && this.apiSecret.length > 0;
  }

  /**
   * Charge a stored recurring token (the server-side renewal / confirm path).
   * Used to bill a subscription period without the widget. Resolves with the
   * provider transaction id + status; rejects on a declined/failed charge.
   *
   * @throws ServiceUnavailableException when keys are unset.
   * @throws Error when the provider returns `Success:false` or a non-2xx.
   */
  async chargeToken(params: ChargeTokenParams): Promise<ChargeTokenResult> {
    const model = await this.post<CloudPaymentsTransactionModel>('/payments/tokens/charge', {
      Token: params.token,
      AccountId: params.accountId,
      Amount: params.amount,
      Currency: params.currency,
      InvoiceId: params.invoiceId,
      Description: params.description,
    });
    return {
      transactionId: typeof model?.TransactionId === 'number' ? model.TransactionId : null,
      status: typeof model?.Status === 'string' ? model.Status : null,
      token: typeof model?.Token === 'string' ? model.Token : null,
    };
  }

  /**
   * Cancel a recurring subscription by its CloudPayments subscription id, so the
   * provider stops billing it. Idempotent upstream: cancelling an already-
   * cancelled/absent subscription is treated as success (the post-condition —
   * "no longer billing" — already holds).
   *
   * @throws ServiceUnavailableException when keys are unset.
   * @throws Error on a genuine provider failure (non-2xx / unexpected message).
   */
  async cancelSubscription(subscriptionId: string): Promise<void> {
    try {
      await this.post<unknown>('/subscriptions/cancel', { Id: subscriptionId });
    } catch (err) {
      // Treat "already cancelled / not found" as success — the goal is that the
      // subscription is no longer billing, which holds in those cases.
      if (this.isAlreadyTerminal(err)) {
        this.logger.warn(
          `Subscription ${subscriptionId} already cancelled/absent upstream — treating as success`,
        );
        return;
      }
      throw err;
    }
  }

  /**
   * Refund a completed payment by its CloudPayments transaction id, optionally
   * partial. Amount is in major units (roubles).
   *
   * @throws ServiceUnavailableException when keys are unset.
   * @throws Error when the provider rejects the refund.
   */
  async refundPayment(transactionId: number, amount: number): Promise<void> {
    await this.post<unknown>('/payments/refund', {
      TransactionId: transactionId,
      Amount: amount,
    });
  }

  // ── internals ───────────────────────────────────────────────────────────────

  /**
   * POST a JSON body to a CloudPayments REST path with Basic auth, returning the
   * `Model` on success. Throws {@link ServiceUnavailableException} when keys are
   * unset, and a plain `Error` on transport failure / non-2xx / `Success:false`.
   */
  private async post<TModel>(path: string, body: Record<string, unknown>): Promise<TModel | undefined> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('payments not configured');
    }

    const url = `${this.apiBase}${path}`;
    const auth = Buffer.from(`${this.publicId}:${this.apiSecret}`).toString('base64');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Basic ${auth}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        // Drop undefined fields so we never send `"Description": undefined`.
        body: JSON.stringify(this.compact(body)),
        signal: controller.signal,
      });
    } catch (err) {
      // Network error / timeout / abort.
      throw new Error(
        `CloudPayments request to ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new Error(`CloudPayments ${path} returned HTTP ${res.status}`);
    }

    let json: CloudPaymentsApiResponse<TModel>;
    try {
      json = (await res.json()) as CloudPaymentsApiResponse<TModel>;
    } catch (err) {
      throw new Error(
        `CloudPayments ${path} returned malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!json.Success) {
      const reason = json.Message ?? 'unknown reason';
      const error = new Error(`CloudPayments ${path} was not successful: ${reason}`);
      // Tag the message so cancel() can recognise an already-terminal subscription.
      (error as Error & { cloudPaymentsMessage?: string }).cloudPaymentsMessage = reason;
      throw error;
    }

    return json.Model;
  }

  /** Strip `undefined`-valued keys so they are omitted from the JSON body. */
  private compact(body: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) {
        out[k] = v;
      }
    }
    return out;
  }

  /**
   * Heuristic: does this error indicate the subscription is already
   * cancelled/absent upstream (so cancelling is a no-op success)? CloudPayments
   * returns a human message like "Subscription not found" / "already cancelled".
   */
  private isAlreadyTerminal(err: unknown): boolean {
    const msg = (err as { cloudPaymentsMessage?: string } | null)?.cloudPaymentsMessage;
    if (typeof msg !== 'string') {
      return false;
    }
    const m = msg.toLowerCase();
    return m.includes('not found') || m.includes('already') || m.includes('cancel');
  }
}
