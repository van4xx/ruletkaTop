import { Inject, Injectable, Optional } from '@nestjs/common';

import { CloudPaymentsClient } from '../modules/payments/cloudpayments.client';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from '../modules/payments/payment-provider';

/**
 * Thin "cancel a recurring subscription upstream" port, decoupled from the
 * payments module's concrete provider via a DI TOKEN.
 *
 * Account-teardown lives in `users` / `moderation`, which deliberately avoid a
 * hard PremiumModule/PaymentsModule dependency. To still stop the provider from
 * billing a torn-down/banned card, those services inject THIS port (bound to
 * {@link CloudPaymentsCancelPort} where PaymentsModule is reachable) and pass
 * its `cancelSubscription` as the `cancelUpstream` callback to the shared
 * teardown helper. It is always injected `@Optional()`: when the binding is
 * absent (or no provider is configured) teardown still drives the LOCAL
 * subscription to a terminal state — the upstream call is best-effort sugar.
 *
 * Provider-agnostic: the concrete adapter forwards to whichever
 * {@link PaymentProvider} is wired by `PAYMENT_PROVIDER` env (T-Bank default,
 * CloudPayments fallback). Legacy `CloudPaymentsClient` is still injected so
 * that LEGACY CloudPayments subscriptions can be cancelled even when the
 * active provider is T-Bank (subscriptionId semantics differ; we try the
 * active provider first, fall back to the legacy CP client).
 */
export interface PaymentsCancelPort {
  /**
   * Best-effort cancel of a recurring subscription upstream by its provider-
   * side subscription id (CloudPayments SubscriptionId / T-Bank RebillId).
   * Never throws — a provider error is swallowed (the local terminal-state
   * drive is the authoritative stop-billing on our side).
   */
  cancelSubscription(subscriptionId: string): Promise<void>;
}

/** DI token for {@link PaymentsCancelPort}. */
export const PAYMENTS_CANCEL_PORT = Symbol('PAYMENTS_CANCEL_PORT');

/**
 * Concrete {@link PaymentsCancelPort} backed by the active
 * {@link PaymentProvider} (T-Bank or CloudPayments). The legacy
 * {@link CloudPaymentsClient} is also injected as a fallback so a teardown of
 * a LEGACY CloudPayments subscription still stops billing when the platform
 * has since switched to T-Bank as the primary provider. No-ops (resolves) when
 * nothing is configured; swallows provider errors so it is always safe to
 * await inside a best-effort teardown.
 */
@Injectable()
export class CloudPaymentsCancelPort implements PaymentsCancelPort {
  constructor(
    @Optional() @Inject(PAYMENT_PROVIDER) private readonly provider?: PaymentProvider,
    @Optional() @Inject(CloudPaymentsClient) private readonly cpClient?: CloudPaymentsClient,
  ) {}

  async cancelSubscription(subscriptionId: string): Promise<void> {
    // 1) Active provider gets first crack (T-Bank no-ops because recurring
    //    charging is driver-side; CloudPaymentsProvider forwards to the legacy
    //    client). If it fails or isn't configured, fall through to the legacy
    //    CloudPayments client so a pre-migration CP subscriptionId is still
    //    cancelled upstream.
    if (this.provider && this.provider.isConfigured()) {
      try {
        await this.provider.cancelSubscription({ providerSubscriptionId: subscriptionId });
        return;
      } catch {
        // best-effort — fall through
      }
    }
    if (this.cpClient && this.cpClient.isConfigured()) {
      try {
        await this.cpClient.cancelSubscription(subscriptionId);
      } catch {
        // Best-effort: the local subscription terminal-state drive is authoritative.
      }
    }
  }
}
