import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { PaymentStatus } from '@ruletka/shared-types';

import {
  type CreateCheckoutInput,
  type CreateCheckoutResult,
  type PaymentProvider,
} from '../payment-provider';
import { TbankClient } from './tbank.client';

/**
 * {@link PaymentProvider} implementation backed by T-Bank (Tinkoff) e-acquiring.
 *
 * Translates the platform's provider-agnostic intents into T-Bank Init/Confirm/
 * Cancel/Refund/GetState/Charge calls, normalises amounts (always kopecks
 * INTEGER), and maps the upstream `Status` enum onto our internal
 * {@link PaymentStatus}. T-Bank's status enum:
 *   NEW | AUTHORIZED | CONFIRMED | REVERSED | REFUNDED | PARTIAL_REFUNDED | REJECTED.
 */
@Injectable()
export class TbankProvider implements PaymentProvider {
  readonly providerName = 'tbank' as const;
  private readonly logger = new Logger(TbankProvider.name);

  /** Where T-Bank should POST webhooks. Read at construction so tests can stub. */
  private readonly notificationUrl: string;
  private readonly successUrl: string;
  private readonly failUrl: string;

  constructor(
    private readonly client: TbankClient,
    private readonly config: ConfigService,
  ) {
    this.notificationUrl = this.config.get<string>('TBANK_NOTIFICATION_URL', '').trim();
    this.successUrl = this.config.get<string>('TBANK_SUCCESS_URL', '').trim();
    this.failUrl = this.config.get<string>('TBANK_FAIL_URL', '').trim();
  }

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    this.assertKopecks(input.amountKopecks);
    if (!input.orderId) {
      throw new BadRequestException('orderId is required');
    }

    const res = await this.client.init({
      amountKopecks: input.amountKopecks,
      orderId: input.orderId,
      description: input.description,
      customerKey: input.userId,
      successURL: input.successUrl ?? (this.successUrl || undefined),
      failURL: input.failUrl ?? (this.failUrl || undefined),
      notificationURL: this.notificationUrl || undefined,
      recurrent: input.recurrent?.enabled === true,
      data: input.data,
    });

    if (!res.Success || typeof res.PaymentURL !== 'string') {
      const reason = res.ErrorCode ?? res.Message ?? 'unknown';
      throw new Error(`T-Bank Init failed for order ${input.orderId}: ${reason}`);
    }

    return {
      paymentUrl: res.PaymentURL,
      providerPaymentId: typeof res.PaymentId === 'string' ? res.PaymentId : null,
      orderId: typeof res.OrderId === 'string' ? res.OrderId : input.orderId,
    };
  }

  async cancelSubscription(input: { providerSubscriptionId: string }): Promise<void> {
    // T-Bank doesn't have a subscription object per se — the renewal cadence
    // is driven BY US via `Charge` against a stored RebillId. Cancelling means
    // we stop initiating those charges. There is no upstream `cancel
    // subscription` call to make. We log for audit symmetry with CloudPayments.
    this.logger.log(
      `T-Bank "cancelSubscription" called for rebillId=${input.providerSubscriptionId} — ` +
        'recurrent charging is driver-side; no upstream call required.',
    );
  }

  async refund(input: {
    providerPaymentId: string;
    amountKopecks?: number;
  }): Promise<{ success: boolean }> {
    if (input.amountKopecks !== undefined) {
      this.assertKopecks(input.amountKopecks);
    }
    const res = await this.client.refund({
      paymentId: input.providerPaymentId,
      amountKopecks: input.amountKopecks,
    });
    if (!res.Success) {
      const reason = res.ErrorCode ?? res.Message ?? 'unknown';
      throw new Error(
        `T-Bank refund failed for payment ${input.providerPaymentId}: ${reason}`,
      );
    }
    return { success: true };
  }

  async getState(input: {
    providerPaymentId: string;
  }): Promise<{ status: PaymentStatus | 'unknown' }> {
    const res = await this.client.getState({ paymentId: input.providerPaymentId });
    return { status: TbankProvider.mapStatus(res.Status) };
  }

  async chargeRecurring(input: {
    rebillId: string;
    amountKopecks: number;
    orderId: string;
    description?: string;
  }): Promise<{ providerPaymentId: string; status: PaymentStatus | 'unknown' }> {
    this.assertKopecks(input.amountKopecks);
    const res = await this.client.charge({
      rebillId: input.rebillId,
      amountKopecks: input.amountKopecks,
      orderId: input.orderId,
      description: input.description,
    });
    if (!res.Success) {
      const reason = res.ErrorCode ?? res.Message ?? 'unknown';
      throw new Error(`T-Bank Charge failed for rebill ${input.rebillId}: ${reason}`);
    }
    return {
      providerPaymentId: typeof res.PaymentId === 'string' ? res.PaymentId : '',
      status: TbankProvider.mapStatus(res.Status),
    };
  }

  /**
   * Map a T-Bank Status string onto our internal {@link PaymentStatus}. Unknown
   * / unexpected values map to `'unknown'` rather than guessing — the webhook
   * handler is the source of truth for state transitions and will log + skip.
   */
  static mapStatus(status: unknown): PaymentStatus | 'unknown' {
    if (typeof status !== 'string') {
      return 'unknown';
    }
    switch (status) {
      case 'CONFIRMED':
      case 'AUTHORIZED':
        return 'completed';
      case 'NEW':
        return 'pending';
      case 'REVERSED':
      case 'REFUNDED':
      case 'PARTIAL_REFUNDED':
        return 'refunded';
      case 'REJECTED':
        return 'failed';
      default:
        return 'unknown';
    }
  }

  /** Reject non-integer / negative kopecks at the adapter boundary. */
  private assertKopecks(amount: number): void {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new BadRequestException(
        `T-Bank amount must be a non-negative INTEGER kopecks; got ${amount}`,
      );
    }
  }
}
