import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type {
  CheckoutWidgetParams,
  CloudPaymentsAck,
  CloudPaymentsNotification,
  CoinsCheckoutDto,
} from '@ruletka/shared-types';

import {
  COIN_PACKAGES_SERVICE,
  type CoinPackagesServiceContract,
  PREMIUM_SERVICE,
  type PremiumServiceContract,
  WALLET_SERVICE,
  type WalletServiceContract,
} from './payments.contracts';
import { Payment, PaymentDocument } from './schemas/payment.schema';

/**
 * Shape of the `data`/`Data` envelope we attach to a checkout and CloudPayments
 * echoes back verbatim in every notification (as a JSON string in `Data`). It
 * carries the SERVER-TRUSTED intent so a webhook can be processed without
 * re-trusting any client input: `purpose` routes the fulfilment, `packageCode`
 * / `plan` identify the catalogue entry, and `userId` is the beneficiary.
 */
interface CheckoutData extends Record<string, unknown> {
  purpose: 'coins' | 'premium';
  userId: string;
  packageCode?: string;
  plan?: string;
}

/** CloudPayments ack signalling "processed successfully, do not retry". */
const ACK_OK: CloudPaymentsAck = { code: 0 } as const;

/**
 * Known CloudPayments recurring-subscription statuses (Recurrent webhook).
 * `Active` means a renewal succeeded; the rest are terminal/non-billing and
 * cause us to cancel local entitlement at period end.
 * @see https://developers.cloudpayments.ru/#uvedomlenie-recurrent
 */
const RECURRENT_ACTIVE = 'Active';
const RECURRENT_TERMINAL = new Set([
  'PastDue',
  'Cancelled',
  'Rejected',
  'Expired',
]);

/**
 * Orchestrates the CloudPayments money flow for coin purchases and premium
 * subscriptions. Owns the `payments` collection (the audit + idempotency
 * ledger) and delegates fulfilment to the economy services via the contract
 * tokens ({@link WALLET_SERVICE}, {@link PREMIUM_SERVICE},
 * {@link COIN_PACKAGES_SERVICE}) so this module never hard-depends on their
 * concrete classes.
 *
 * ── Idempotency model ──────────────────────────────────────────────────────
 * `invoiceId` (a fresh UUID minted at checkout) is the idempotency key. Webhook
 * fulfilment is gated on the Payment's terminal `status`: once a Payment is
 * `completed` (or `refunded`/`failed`), redelivered notifications are ack'd with
 * `{ code: 0 }` WITHOUT re-crediting coins or re-activating premium. The
 * fulfilment write happens BEFORE the side effect is acknowledged so a crash
 * between them is recovered by CloudPayments' automatic redelivery.
 *
 * NEVER trusts client-sent amounts: `amount` is fixed from the server-side
 * package/plan price at checkout, and the Pay handler additionally cross-checks
 * the notified `Amount` against the stored Payment.
 *
 * No card data ever reaches this service — PAN/CVV stay inside the CloudPayments
 * widget; only opaque tokens/ids flow through here.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly publicId: string;
  private readonly currency = 'RUB';

  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    private readonly config: ConfigService,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletServiceContract,
    @Inject(PREMIUM_SERVICE) private readonly premium: PremiumServiceContract,
    @Inject(COIN_PACKAGES_SERVICE)
    private readonly coinPackages: CoinPackagesServiceContract,
  ) {
    this.publicId = this.config.get<string>('CLOUDPAYMENTS_PUBLIC_ID', '');
  }

  // ── Checkout (authenticated) ───────────────────────────────────────────────

  /**
   * Begin a coins purchase: resolve the package server-side, mint a PENDING
   * {@link Payment} with a unique `invoiceId`, and return the params the client
   * feeds to the CloudPayments widget. The price comes from the catalogue —
   * the request body only names the package, never the amount.
   *
   * @throws NotFoundException when `packageCode` is unknown.
   */
  async createCoinsCheckout(
    userId: string,
    dto: CoinsCheckoutDto,
  ): Promise<CheckoutWidgetParams> {
    const pkg = await this.coinPackages.findByCode(dto.packageCode);
    if (!pkg) {
      throw new NotFoundException('Coin package not found');
    }

    const invoiceId = randomUUID();
    const amount = pkg.priceRub;

    await this.paymentModel.create({
      userId: new Types.ObjectId(userId),
      provider: 'cloudpayments',
      invoiceId,
      amount,
      currency: this.currency,
      status: 'pending',
      purpose: 'coins',
      packageCode: pkg.code,
    });

    const data: CheckoutData = {
      purpose: 'coins',
      packageCode: pkg.code,
      userId,
    };

    return {
      publicId: this.publicId,
      invoiceId,
      amount,
      currency: this.currency,
      accountId: userId,
      description: `${pkg.coins + pkg.bonusCoins} coins (${pkg.code})`,
      data,
    };
  }

  // ── Webhooks (public; HMAC-verified upstream by the signature guard) ─────────

  /**
   * `Check` — CloudPayments asks whether to authorise the charge. We validate
   * that the invoice exists, is still pending, and the amount matches, then ack
   * `0` (approve). A missing/processed/mismatched invoice is rejected with a
   * non-zero code so the charge never goes through. Read-only: no mutation.
   */
  async handleCheck(n: CloudPaymentsNotification): Promise<CloudPaymentsAck> {
    const payment = n.InvoiceId
      ? await this.paymentModel.findOne({ invoiceId: n.InvoiceId }).exec()
      : null;

    if (!payment) {
      // Unknown invoice ⇒ decline (11).
      return { code: 11 };
    }
    // Re-delivered Check after we already fulfilled: approve (idempotent ack 0).
    if (payment.status === 'completed') {
      return ACK_OK;
    }
    if (payment.status !== 'pending') {
      // failed/refunded ⇒ do not re-authorise.
      return { code: 11 };
    }
    if (n.Amount !== undefined && !this.amountMatches(payment.amount, n.Amount)) {
      this.logger.warn(
        `Check amount mismatch for invoice ${payment.invoiceId}: expected ${payment.amount}, got ${n.Amount}`,
      );
      return { code: 11 };
    }
    return ACK_OK;
  }

  /**
   * `Pay` — the charge succeeded. Idempotently fulfil:
   *  - coins  → mark the Payment completed and credit `coins + bonus`.
   *  - premium → mark completed and activate the subscription period.
   *
   * Double-delivery safety: fulfilment is guarded by an atomic
   * `pending → completed` transition (`findOneAndUpdate` on `status: 'pending'`).
   * Only the call that wins the transition performs the side effect; a second
   * delivery sees a non-pending status and acks `0` without re-crediting.
   */
  async handlePay(n: CloudPaymentsNotification): Promise<CloudPaymentsAck> {
    const payment = await this.findByNotification(n);
    if (!payment) {
      // Nothing to fulfil; ack 0 so CloudPayments stops retrying an orphan.
      this.logger.warn(`Pay for unknown invoice ${n.InvoiceId ?? '(none)'}`);
      return ACK_OK;
    }

    // Already terminal ⇒ idempotent no-op (single credit guarantee).
    if (payment.status !== 'pending') {
      return ACK_OK;
    }

    // Defence-in-depth: never fulfil if the paid amount differs from our price.
    if (n.Amount !== undefined && !this.amountMatches(payment.amount, n.Amount)) {
      this.logger.error(
        `Pay amount mismatch for invoice ${payment.invoiceId}: expected ${payment.amount}, got ${n.Amount} — not fulfilling`,
      );
      return ACK_OK;
    }

    // Atomically claim the Payment: only the winner of pending→completed runs
    // fulfilment, making concurrent/duplicate webhooks credit exactly once.
    const claimed = await this.paymentModel
      .findOneAndUpdate(
        { _id: payment._id, status: 'pending' },
        {
          $set: {
            status: 'completed',
            transactionId: n.TransactionId ?? null,
            subscriptionId: n.SubscriptionId ?? null,
            subscriptionToken: n.Token ?? null,
            rawPayload: { ...n },
          },
        },
        { new: true },
      )
      .exec();

    if (!claimed) {
      // Lost the race to a concurrent delivery — the winner fulfils. Ack 0.
      return ACK_OK;
    }

    try {
      if (claimed.purpose === 'coins') {
        await this.fulfilCoins(claimed);
      } else {
        await this.fulfilPremium(claimed, n.Token ?? undefined);
      }
    } catch (err) {
      // Roll the claim back to pending so a redelivery can retry fulfilment;
      // surface the error so the guard/controller returns non-200 and triggers
      // CloudPayments' retry.
      await this.paymentModel
        .updateOne({ _id: claimed._id }, { $set: { status: 'pending' } })
        .exec();
      this.logger.error(
        `Fulfilment failed for invoice ${claimed.invoiceId}; rolled back to pending: ${
          (err as Error).message
        }`,
      );
      throw err;
    }

    return ACK_OK;
  }

  /**
   * `Fail` — the charge failed/declined. Mark the (still-pending) Payment
   * `failed` for audit. Idempotent: a completed payment is never demoted. Always
   * ack `0` (the response code does not affect CloudPayments retry behaviour).
   */
  async handleFail(n: CloudPaymentsNotification): Promise<CloudPaymentsAck> {
    const payment = await this.findByNotification(n);
    if (payment && payment.status === 'pending') {
      await this.paymentModel
        .updateOne(
          { _id: payment._id, status: 'pending' },
          { $set: { status: 'failed', rawPayload: { ...n } } },
        )
        .exec();
    }
    return ACK_OK;
  }

  /**
   * `Confirm` — second stage of a two-step (DMS) payment. We treat the actual
   * money movement as the `Pay` event, so here we only record the transaction
   * id / raw payload for audit without changing fulfilment state. Idempotent.
   */
  async handleConfirm(n: CloudPaymentsNotification): Promise<CloudPaymentsAck> {
    const payment = await this.findByNotification(n);
    if (payment) {
      await this.paymentModel
        .updateOne(
          { _id: payment._id },
          {
            $set: {
              transactionId: n.TransactionId ?? payment.transactionId ?? null,
              rawPayload: { ...n },
            },
          },
        )
        .exec();
    }
    return ACK_OK;
  }

  /**
   * `Recurrent` — a subscription billing attempt result. On `Active` we renew
   * premium for another interval; on any terminal status
   * (`PastDue`/`Cancelled`/`Rejected`/`Expired`) we cancel local entitlement.
   * Keyed by `SubscriptionId` (falling back to invoice). Always ack `0`.
   */
  async handleRecurrent(n: CloudPaymentsNotification): Promise<CloudPaymentsAck> {
    const userId = this.userIdFromNotification(n);
    if (!userId) {
      this.logger.warn('Recurrent notification without a resolvable userId');
      return ACK_OK;
    }

    const status = n.Status ?? '';
    if (status === RECURRENT_ACTIVE) {
      const plan = await this.planFromRecurrent(n, userId);
      const periodEnd = await this.computePeriodEnd(plan);
      await this.premium.activate(userId, plan, periodEnd, n.Token ?? undefined);
      this.logger.log(`Renewed premium for user ${userId} (plan ${plan})`);
    } else if (RECURRENT_TERMINAL.has(status)) {
      await this.premium.cancel(userId);
      this.logger.log(`Canceled premium for user ${userId} (recurrent ${status})`);
    } else {
      this.logger.warn(`Unhandled Recurrent status "${status}" for user ${userId}`);
    }
    return ACK_OK;
  }

  /**
   * `Refund` — a charge was refunded. Mark the Payment `refunded` and reverse
   * the fulfilment: debit the credited coins back (best-effort — a spent balance
   * may go negative-guarded and is logged) or cancel premium. Idempotent: a
   * payment already `refunded` is a no-op. Always ack `0`.
   */
  async handleRefund(n: CloudPaymentsNotification): Promise<CloudPaymentsAck> {
    const payment = await this.findByNotification(n);
    if (!payment) {
      return ACK_OK;
    }
    if (payment.status === 'refunded') {
      return ACK_OK; // already reversed
    }

    // Atomically claim the refund so the reversal runs exactly once.
    const claimed = await this.paymentModel
      .findOneAndUpdate(
        { _id: payment._id, status: { $ne: 'refunded' } },
        { $set: { status: 'refunded', rawPayload: { ...n } } },
        { new: true },
      )
      .exec();
    if (!claimed) {
      return ACK_OK;
    }

    // Only reverse fulfilment that actually happened (the payment had completed).
    if (payment.status === 'completed') {
      try {
        if (claimed.purpose === 'coins') {
          await this.reverseCoins(claimed);
        } else {
          await this.premium.cancel(claimed.userId.toString());
        }
      } catch (err) {
        // Don't fail the webhook: the refund itself already happened upstream.
        // The Payment is marked refunded for audit; reversal issues are logged.
        this.logger.error(
          `Refund reversal issue for invoice ${claimed.invoiceId}: ${(err as Error).message}`,
        );
      }
    }
    return ACK_OK;
  }

  // ── internals ───────────────────────────────────────────────────────────────

  /** Credit purchased coins (base + bonus) keyed by invoiceId for idempotency. */
  private async fulfilCoins(payment: PaymentDocument): Promise<void> {
    const code = payment.packageCode;
    if (!code) {
      throw new BadRequestException('Coins payment missing packageCode');
    }
    const pkg = await this.coinPackages.findByCode(code);
    if (!pkg) {
      throw new NotFoundException(`Coin package ${code} no longer exists`);
    }
    const total = pkg.coins + pkg.bonusCoins;
    await this.wallet.credit(payment.userId.toString(), total, 'purchase', payment.invoiceId);
    this.logger.log(
      `Credited ${total} coins to user ${payment.userId.toString()} for invoice ${payment.invoiceId}`,
    );
  }

  /** Activate premium for the paid interval, persisting the recurring token. */
  private async fulfilPremium(payment: PaymentDocument, token?: string): Promise<void> {
    const plan = payment.plan ?? 'monthly';
    const periodEnd = await this.computePeriodEnd(plan);
    await this.premium.activate(payment.userId.toString(), plan, periodEnd, token);
    this.logger.log(
      `Activated premium (plan ${plan}) for user ${payment.userId.toString()} until ${periodEnd.toISOString()}`,
    );
  }

  /** Debit previously-credited coins back out on a refund (best-effort). */
  private async reverseCoins(payment: PaymentDocument): Promise<void> {
    const code = payment.packageCode;
    if (!code) {
      return;
    }
    const pkg = await this.coinPackages.findByCode(code);
    if (!pkg) {
      return;
    }
    const total = pkg.coins + pkg.bonusCoins;
    // refId namespaced so the refund ledger row is distinct from the purchase.
    await this.wallet.debit(payment.userId.toString(), total, 'refund', `refund:${payment.invoiceId}`);
    this.logger.log(
      `Reversed ${total} coins from user ${payment.userId.toString()} for refunded invoice ${payment.invoiceId}`,
    );
  }

  /**
   * Locate the Payment a notification refers to, preferring our `InvoiceId`
   * (the idempotency key) and falling back to the provider `TransactionId`.
   */
  private async findByNotification(
    n: CloudPaymentsNotification,
  ): Promise<PaymentDocument | null> {
    if (n.InvoiceId) {
      const byInvoice = await this.paymentModel.findOne({ invoiceId: n.InvoiceId }).exec();
      if (byInvoice) {
        return byInvoice;
      }
    }
    if (n.TransactionId !== undefined) {
      return this.paymentModel.findOne({ transactionId: n.TransactionId }).exec();
    }
    return null;
  }

  /**
   * Resolve the beneficiary userId for a notification: the `Data` envelope we
   * minted at checkout is authoritative; `AccountId` (which we set to the user
   * id on the widget) is the fallback.
   */
  private userIdFromNotification(n: CloudPaymentsNotification): string | null {
    const data = this.parseData(n.Data);
    const fromData = typeof data?.userId === 'string' ? data.userId : null;
    const candidate = fromData ?? n.AccountId ?? null;
    return candidate && Types.ObjectId.isValid(candidate) ? candidate : null;
  }

  /**
   * Determine the premium plan for a Recurrent renewal: prefer the original
   * Payment's plan (looked up via SubscriptionId), then the echoed `Data.plan`,
   * defaulting to `monthly`.
   */
  private async planFromRecurrent(
    n: CloudPaymentsNotification,
    _userId: string,
  ): Promise<string> {
    if (n.SubscriptionId) {
      const prior = await this.paymentModel
        .findOne({ subscriptionId: n.SubscriptionId, purpose: 'premium' })
        .sort({ createdAt: -1 })
        .exec();
      if (prior?.plan) {
        return prior.plan;
      }
    }
    const data = this.parseData(n.Data);
    return typeof data?.plan === 'string' ? data.plan : 'monthly';
  }

  /**
   * Compute the end of a freshly-paid period from the plan's `intervalDays`
   * (via the premium catalogue, defaulting to 30 days when unavailable),
   * measured from now.
   */
  private async computePeriodEnd(plan: string): Promise<Date> {
    let intervalDays = 30;
    // The premium contract exposes plan lookup only via the concrete service;
    // fall back to a sane default if the catalogue can't be consulted here.
    const planLookup = (this.premium as Partial<{
      findPlanByCode(code: string): Promise<{ intervalDays: number } | null>;
    }>).findPlanByCode;
    if (typeof planLookup === 'function') {
      const found = await planLookup.call(this.premium, plan);
      if (found && Number.isFinite(found.intervalDays) && found.intervalDays > 0) {
        intervalDays = found.intervalDays;
      }
    }
    return new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000);
  }

  /** Parse the echoed `Data` JSON string into an object, or `null` on garbage. */
  private parseData(raw: string | undefined): Record<string, unknown> | null {
    if (!raw) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  /** Whole-ruble amount equality with a cent tolerance (provider may send floats). */
  private amountMatches(expected: number, actual: number): boolean {
    return Math.abs(expected - actual) < 0.01;
  }
}
