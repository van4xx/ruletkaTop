import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { PaymentStatus } from '@ruletka/shared-types';

import { CloudPaymentsClient } from './cloudpayments.client';
import {
  type CreateCheckoutInput,
  type CreateCheckoutResult,
  type PaymentProvider,
} from './payment-provider';

/**
 * Legacy CloudPayments adapter, kept alive behind {@link PaymentProvider} so the
 * platform can fall back to it via `PAYMENT_PROVIDER=cloudpayments` if the
 * primary T-Bank provider has to be swapped back.
 *
 * CloudPayments' hosted-widget flow is fundamentally different from T-Bank's
 * redirect: the BROWSER opens a JS widget with server-minted params, the
 * server has no `paymentUrl`. To still expose a uniform contract:
 *
 *   - `createCheckout(...)` returns `paymentUrl: ''` AND attaches the widget
 *     params via the `data` echo path (the platform's existing checkout
 *     endpoints have been refactored to return the params directly from the
 *     payments service for cloudpayments; the provider's `paymentUrl` is what
 *     the new T-Bank flow uses). The web UI gates its widget loader on
 *     `PAYMENT_PROVIDER === 'cloudpayments'`.
 *   - `refund` translates kopecks → roubles (CloudPayments speaks roubles as a
 *     float). The exposed return is `{success: true}` on a clean refund.
 *   - `cancelSubscription` defers to the legacy `cloudpayments.client.ts` which
 *     idempotently no-ops on already-cancelled subscriptions.
 */
@Injectable()
export class CloudPaymentsProvider implements PaymentProvider {
  readonly providerName = 'cloudpayments' as const;
  private readonly logger = new Logger(CloudPaymentsProvider.name);
  private readonly publicId: string;

  constructor(
    private readonly client: CloudPaymentsClient,
    private readonly config: ConfigService,
  ) {
    this.publicId = this.config.get<string>('CLOUDPAYMENTS_PUBLIC_ID', '').trim();
  }

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  /**
   * CloudPayments has no Init endpoint we can call to receive a redirect URL —
   * the browser opens the widget directly with server-minted params. The
   * payments service still routes through this method when the provider is
   * `cloudpayments` so the call graph is uniform; we surface `paymentUrl: ''`
   * + the providerPaymentId stays null (CP issues a TransactionId only on
   * webhook). The widget params come from the payments service, which has
   * provider-specific knowledge of the PublicId.
   */
  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    this.logger.debug(
      `CloudPayments createCheckout for order ${input.orderId} — widget params are returned by ` +
        'the payments service; PaymentURL is empty (browser opens the widget).',
    );
    return {
      paymentUrl: '',
      providerPaymentId: null,
      orderId: input.orderId,
    };
  }

  async cancelSubscription(input: { providerSubscriptionId: string }): Promise<void> {
    await this.client.cancelSubscription(input.providerSubscriptionId);
  }

  async refund(input: {
    providerPaymentId: string;
    amountKopecks?: number;
  }): Promise<{ success: boolean }> {
    const txId = Number(input.providerPaymentId);
    if (!Number.isFinite(txId)) {
      throw new Error(
        `CloudPayments refund: providerPaymentId is not a CloudPayments TransactionId number: ${input.providerPaymentId}`,
      );
    }
    if (input.amountKopecks === undefined) {
      throw new Error('CloudPayments refund: amountKopecks is required for refund');
    }
    // CP speaks roubles (major units) as a float, kopecks → roubles.
    const amountRub = input.amountKopecks / 100;
    await this.client.refundPayment(txId, amountRub);
    return { success: true };
  }

  async getState(_input: {
    providerPaymentId: string;
  }): Promise<{ status: PaymentStatus | 'unknown' }> {
    // CloudPayments has no documented read-by-id endpoint we use today — return
    // 'unknown' so callers fall back to the local Payment.status. The legacy
    // webhook flow drives status updates; this is a parity stub.
    return { status: 'unknown' };
  }

  /** Server-issued PublicId — exposed so the payments service can include it in widget params. */
  getPublicId(): string {
    return this.publicId;
  }
}
