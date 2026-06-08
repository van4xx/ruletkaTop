import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

import type { AdminPayment, AdminPaymentList, AdminPaymentStats } from '@ruletka/shared-types';

import { PaymentsService } from '../payments/payments.service';

/** Charges per page. */
const PAGE = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A `payments` row as read for the list. */
interface PaymentRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  provider?: string;
  invoiceId?: string;
  amount?: number;
  currency?: string;
  status?: string;
  purpose?: string;
  createdAt?: Date;
}

/**
 * Admin payments surface. REAL — reads the `payments` collection (owned by
 * PaymentsModule) by name via the shared connection, so it forms no module
 * dependency. The list is cursor-paginated newest-first; the stats endpoint
 * aggregates revenue + the status funnel.
 */
@Injectable()
export class AdminPaymentsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly paymentsService: PaymentsService,
  ) {}

  /**
   * Refund a completed charge by Payment id. Delegates to the authoritative
   * {@link PaymentsService.refundByAdmin}, which calls CloudPayments to refund
   * the money AND reverses fulfilment (debit coins / cancel premium). Returns
   * the refunded amount + provider transaction id for the audit trail.
   */
  async refund(paymentId: string): Promise<{ amount: number; transactionId: number | null }> {
    return this.paymentsService.refundByAdmin(paymentId);
  }

  /** A page of charges, newest first. Keyset-paginated on `_id`. */
  async list(cursor?: string): Promise<AdminPaymentList> {
    // Plain native-driver filter (this reads `payments` by name, not via a model).
    const filter: Record<string, unknown> = {};
    if (cursor && Types.ObjectId.isValid(cursor)) {
      filter._id = { $lt: new Types.ObjectId(cursor) };
    }

    const rows = (await this.connection
      .collection('payments')
      .find(filter, {
        projection: {
          userId: 1,
          provider: 1,
          invoiceId: 1,
          amount: 1,
          currency: 1,
          status: 1,
          purpose: 1,
          createdAt: 1,
        },
      })
      .sort({ _id: -1 })
      .limit(PAGE + 1)
      .toArray()) as unknown as PaymentRow[];

    const hasMore = rows.length > PAGE;
    const page = hasMore ? rows.slice(0, PAGE) : rows;
    const last = page.at(-1);

    return {
      items: page.map((r) => this.toPayment(r)),
      nextCursor: hasMore && last ? last._id.toString() : null,
      hasMore,
    };
  }

  /** Revenue (completed) + the status funnel counts. */
  async getStats(): Promise<AdminPaymentStats> {
    const payments = this.connection.collection('payments');
    const since24h = new Date(Date.now() - DAY_MS);

    const [
      revenueRubTotal,
      revenueRub24h,
      completedCount,
      pendingCount,
      failedCount,
      refundedCount,
    ] = await Promise.all([
      this.sum(payments, { status: 'completed' }),
      this.sum(payments, { status: 'completed', createdAt: { $gte: since24h } }),
      payments.countDocuments({ status: 'completed' }),
      payments.countDocuments({ status: 'pending' }),
      payments.countDocuments({ status: 'failed' }),
      payments.countDocuments({ status: 'refunded' }),
    ]);

    return {
      revenueRubTotal,
      revenueRub24h,
      completedCount,
      pendingCount,
      failedCount,
      refundedCount,
    };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Σ of `amount` across a filtered set of payments. */
  private async sum(
    collection: ReturnType<Connection['collection']>,
    match: Record<string, unknown>,
  ): Promise<number> {
    const rows = await collection
      .aggregate<{
        total: number;
      }>([{ $match: match }, { $group: { _id: null, total: { $sum: '$amount' } } }])
      .toArray();
    return rows[0]?.total ?? 0;
  }

  /** Map a `payments` row to the admin contract shape. */
  private toPayment(r: PaymentRow): AdminPayment {
    return {
      id: r._id.toString(),
      userId: r.userId.toString(),
      provider: r.provider ?? 'cloudpayments',
      invoiceId: r.invoiceId ?? '',
      amount: r.amount ?? 0,
      currency: r.currency ?? 'RUB',
      status: r.status ?? 'pending',
      purpose: r.purpose ?? '',
      createdAt: (r.createdAt ?? new Date()).toISOString(),
    };
  }
}
