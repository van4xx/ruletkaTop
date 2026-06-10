import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { signTbankToken, type TbankPayload } from './tbank-signature';

/**
 * Thin axios-style fetch client for the T-Bank (Tinkoff) e-acquiring API.
 *
 * Endpoints we cover (all POST JSON, all signed with the same `Token` field):
 *   - `Init`    create a payment and get the redirect PaymentURL.
 *   - `Confirm` two-stage capture (we don't use it for the regular flow but it
 *               is wired so callers can opt in).
 *   - `Cancel`  cancel a payment that hasn't captured yet.
 *   - `Refund`  full/partial refund of a captured payment (kopecks).
 *   - `GetState` read the current status of a payment.
 *   - `Charge`  recurring charge against a stored RebillId.
 *
 * Auth: TerminalKey identifies the merchant; every body carries a `Token`
 * computed by {@link signTbankToken}. The password is a SECRET — never logged.
 *
 * Not-configured posture: if TerminalKey OR Password is unset, every method
 * throws a clear {@link ServiceUnavailableException}. The class is always
 * INSTANTIABLE so the module graph wires in dev/CI without keys; only an actual
 * outbound CALL fails.
 *
 * @see https://developer.tbank.ru/eacq
 */

/** Default prod API base. DEMO/test terminals use the SAME URL. */
const DEFAULT_API_URL = 'https://securepay.tinkoff.ru/v2/';

/** Per-request timeout. T-Bank is normally fast; bound the tail. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Common response envelope of the T-Bank API. `Success` is always present
 * (boolean); errors carry `ErrorCode` (string) + `Message` / `Details`.
 */
export interface TbankResponse {
  Success: boolean;
  ErrorCode?: string;
  Message?: string;
  Details?: string;
  TerminalKey?: string;
  OrderId?: string;
  PaymentId?: string;
  PaymentURL?: string;
  Status?: string;
  Amount?: number;
  // Any other field T-Bank sends back; kept as unknown for safety.
  [key: string]: unknown;
}

@Injectable()
export class TbankClient {
  private readonly logger = new Logger(TbankClient.name);
  private readonly terminalKey: string;
  private readonly password: string;
  private readonly apiUrl: string;

  constructor(private readonly config: ConfigService) {
    this.terminalKey = this.config.get<string>('TBANK_TERMINAL_KEY', '').trim();
    this.password = this.config.get<string>('TBANK_PASSWORD', '').trim();
    this.apiUrl = this.normaliseBase(this.config.get<string>('TBANK_API_URL', DEFAULT_API_URL));
  }

  /** Whether outbound calls are possible (both credentials present). */
  isConfigured(): boolean {
    return this.terminalKey.length > 0 && this.password.length > 0;
  }

  /** Active TerminalKey (for diagnostics / matching webhooks). Never logs the password. */
  getTerminalKey(): string {
    return this.terminalKey;
  }

  /** Active merchant password — used by the webhook guard for Token verification. */
  getPassword(): string {
    return this.password;
  }

  // ── Endpoints ──────────────────────────────────────────────────────────────

  /**
   * `Init` — create a payment. The body MUST carry TerminalKey, Amount (kopecks
   * integer), OrderId (idempotent). Returns the hosted PaymentURL to redirect
   * the browser to and a PaymentId we persist for later Confirm/Cancel/Refund.
   *
   * `Receipt` and `DATA` are nested and so NOT signed; we still send them.
   */
  async init(params: {
    amountKopecks: number;
    orderId: string;
    description?: string;
    customerKey?: string;
    successURL?: string;
    failURL?: string;
    notificationURL?: string;
    recurrent?: boolean;
    data?: Record<string, string>;
  }): Promise<TbankResponse> {
    const body: TbankPayload = {
      TerminalKey: this.terminalKey,
      Amount: params.amountKopecks,
      OrderId: params.orderId,
    };
    if (params.description) {
      body.Description = params.description;
    }
    if (params.customerKey) {
      body.CustomerKey = params.customerKey;
    }
    if (params.successURL) {
      body.SuccessURL = params.successURL;
    }
    if (params.failURL) {
      body.FailURL = params.failURL;
    }
    if (params.notificationURL) {
      body.NotificationURL = params.notificationURL;
    }
    if (params.recurrent) {
      // T-Bank docs: `Recurrent: "Y"` on the FIRST charge → gateway returns a
      // RebillId in the webhook so we can later `Charge` against it.
      body.Recurrent = 'Y';
    }
    const signed = this.sign(body);
    // DATA is a nested map → NOT signed, but still transmitted so the webhook
    // can echo it back. Each value must be a string per T-Bank docs.
    if (params.data) {
      (signed as TbankPayload).DATA = params.data;
    }
    return this.post('Init', signed);
  }

  /** `Confirm` — capture a two-stage payment by its PaymentId. */
  async confirm(params: { paymentId: string; amountKopecks?: number }): Promise<TbankResponse> {
    const body: TbankPayload = {
      TerminalKey: this.terminalKey,
      PaymentId: params.paymentId,
    };
    if (params.amountKopecks !== undefined) {
      body.Amount = params.amountKopecks;
    }
    return this.post('Confirm', this.sign(body));
  }

  /** `Cancel` — cancel a payment that has not captured yet (or refund-like). */
  async cancel(params: { paymentId: string; amountKopecks?: number }): Promise<TbankResponse> {
    const body: TbankPayload = {
      TerminalKey: this.terminalKey,
      PaymentId: params.paymentId,
    };
    if (params.amountKopecks !== undefined) {
      body.Amount = params.amountKopecks;
    }
    return this.post('Cancel', this.sign(body));
  }

  /**
   * `Refund` — full or partial refund of a captured payment. T-Bank's API
   * actually accepts refunds through `Cancel` after capture as well, but the
   * dedicated path is what we prefer for clarity.
   */
  async refund(params: { paymentId: string; amountKopecks?: number }): Promise<TbankResponse> {
    // T-Bank: refunds go through the SAME `Cancel` endpoint, which transitions
    // a captured payment to REVERSED / REFUNDED depending on whether it's full
    // or partial. We expose a `refund(...)` name for clarity to callers.
    return this.cancel(params);
  }

  /** `GetState` — read the current upstream Status of a payment. */
  async getState(params: { paymentId: string }): Promise<TbankResponse> {
    const body: TbankPayload = {
      TerminalKey: this.terminalKey,
      PaymentId: params.paymentId,
    };
    return this.post('GetState', this.sign(body));
  }

  /**
   * `Charge` — charge an existing RebillId for a renewal. The flow is:
   *   1. call `Init` with a fresh OrderId and Amount → get PaymentId.
   *   2. call `Charge` with that PaymentId + RebillId → gateway captures.
   * We expose both in one call for ergonomic recurring renewals.
   */
  async charge(params: {
    rebillId: string;
    amountKopecks: number;
    orderId: string;
    description?: string;
  }): Promise<TbankResponse> {
    // Step 1: Init a payment we will then Charge.
    const init = await this.init({
      amountKopecks: params.amountKopecks,
      orderId: params.orderId,
      description: params.description,
    });
    if (!init.Success || typeof init.PaymentId !== 'string') {
      throw new Error(`T-Bank Init for renewal failed: ${init.ErrorCode ?? init.Message ?? '?'}`);
    }
    // Step 2: Charge the just-created PaymentId against the stored RebillId.
    const body: TbankPayload = {
      TerminalKey: this.terminalKey,
      PaymentId: init.PaymentId,
      RebillId: params.rebillId,
    };
    return this.post('Charge', this.sign(body));
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Compute Token over the SCALAR fields of `body` and attach it. Returns a new object. */
  private sign(body: TbankPayload): TbankPayload {
    const token = signTbankToken(body, this.password);
    return { ...body, Token: token };
  }

  /** POST JSON to `${apiUrl}${method}`. Throws on non-2xx / network errors. */
  private async post(method: string, body: TbankPayload): Promise<TbankResponse> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('payments not configured');
    }
    const url = `${this.apiUrl}${method}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        `T-Bank ${method} request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new Error(`T-Bank ${method} returned HTTP ${res.status}`);
    }

    let json: TbankResponse;
    try {
      json = (await res.json()) as TbankResponse;
    } catch (err) {
      throw new Error(
        `T-Bank ${method} returned malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (json.Success === false) {
      this.logger.warn(
        `T-Bank ${method} not successful: ErrorCode=${json.ErrorCode ?? '?'} Message=${
          json.Message ?? '?'
        }`,
      );
    }

    return json;
  }

  /** Ensure the base URL ends with a single trailing slash. */
  private normaliseBase(url: string): string {
    const trimmed = url.trim();
    if (trimmed.length === 0) {
      return DEFAULT_API_URL;
    }
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  }
}
