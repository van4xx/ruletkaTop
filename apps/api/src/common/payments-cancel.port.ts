import { Inject, Injectable, Optional } from '@nestjs/common';

import { CloudPaymentsClient } from '../modules/payments/cloudpayments.client';

/**
 * Thin "cancel a CloudPayments subscription upstream" port, decoupled from the
 * payments module's concrete client via a DI TOKEN.
 *
 * Account-teardown lives in `users` / `moderation`, which deliberately avoid a
 * hard PremiumModule/PaymentsModule dependency. To still stop the provider from
 * billing a torn-down/banned card, those services inject THIS port (bound to
 * {@link CloudPaymentsCancelPort} where PaymentsModule is reachable) and pass
 * its `cancelSubscription` as the `cancelUpstream` callback to the shared
 * teardown helper. It is always injected `@Optional()`: when the binding is
 * absent (or CloudPayments is unconfigured) teardown still drives the LOCAL
 * subscription to a terminal state — the upstream call is best-effort sugar.
 */
export interface PaymentsCancelPort {
  /**
   * Best-effort cancel of a recurring subscription upstream by its CloudPayments
   * subscription id. Never throws — a provider error is swallowed (the local
   * terminal-state drive is the authoritative stop-billing on our side).
   */
  cancelSubscription(subscriptionId: string): Promise<void>;
}

/** DI token for {@link PaymentsCancelPort}. */
export const PAYMENTS_CANCEL_PORT = Symbol('PAYMENTS_CANCEL_PORT');

/**
 * Concrete {@link PaymentsCancelPort} backed by the outbound
 * {@link CloudPaymentsClient}. No-ops (resolves) when CloudPayments isn't
 * configured, and swallows provider errors so it is always safe to await inside
 * a best-effort teardown.
 */
@Injectable()
export class CloudPaymentsCancelPort implements PaymentsCancelPort {
  constructor(
    @Optional() @Inject(CloudPaymentsClient) private readonly client?: CloudPaymentsClient,
  ) {}

  async cancelSubscription(subscriptionId: string): Promise<void> {
    if (!this.client || !this.client.isConfigured()) {
      return;
    }
    try {
      await this.client.cancelSubscription(subscriptionId);
    } catch {
      // Best-effort: the local subscription terminal-state drive is authoritative.
    }
  }
}
