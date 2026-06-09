import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import type {
  CheckoutWidgetParams,
  CloudPaymentsAck,
  CloudPaymentsNotification,
  CoinsCheckoutDto,
} from '@ruletka/shared-types';

import { MetricsService } from '../../observability/metrics.service';
import { CloudPaymentsClient } from './cloudpayments.client';
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

/**
 * The wallet the payments service actually talks to. Structurally it is the
 * cross-module {@link WalletServiceContract} (getBalance/credit/debit), but the
 * concrete economy `WalletService` bound to {@link WALLET_SERVICE} also exposes
 * a refund-with-debt reversal. We widen the injected type LOCALLY (rather than
 * editing the shared contract) so a refund/chargeback that can't be fully clawed
 * back records the unrecovered value as account debt + an economy hold instead
 * of silently keeping the spent value free.
 */
interface RefundCapableWallet extends WalletServiceContract {
  /**
   * Reverse a previously-credited payment, clawing back what the balance still
   * holds and recording any shortfall (already-spent value) as debt under an
   * economy hold. Returns the coins reversed and the debt held.
   */
  reverseRefund(
    userId: string,
    coins: number,
    refId: string,
  ): Promise<{ reversed: number; owed: number }>;
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
const RECURRENT_TERMINAL = new Set(['PastDue', 'Cancelled', 'Rejected', 'Expired']);

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
    @Inject(WALLET_SERVICE) private readonly wallet: RefundCapableWallet,
    @Inject(PREMIUM_SERVICE) private readonly premium: PremiumServiceContract,
    @Inject(COIN_PACKAGES_SERVICE)
    private readonly coinPackages: CoinPackagesServiceContract,
    private readonly cloudPayments: CloudPaymentsClient,
    // Shared connection, used ONLY to read the `users` source-of-truth so a
    // tombstoned (`deletedAt`) / banned account can never be (re-)entitled by a
    // webhook. Optional so the service still instantiates where no connection is
    // bound (e.g. focused unit tests) — when absent the guard fails OPEN (the
    // amount/idempotency guards above remain the primary defence).
    @Optional() @InjectConnection() private readonly connection?: Connection,
    // OBSERVABILITY (emit-only): durable, alertable money counters. Optional so
    // focused unit tests that don't wire MetricsService still instantiate; every
    // emit is best-effort and NEVER alters the payment flow.
    @Optional() private readonly metrics?: MetricsService,
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
  async createCoinsCheckout(userId: string, dto: CoinsCheckoutDto): Promise<CheckoutWidgetParams> {
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

  /**
   * Begin a premium subscription purchase: resolve the plan server-side, mint a
   * PENDING {@link Payment} with a unique `invoiceId`, and return the widget
   * params — INCLUDING the `cloudPayments.recurrent` descriptor so the first
   * charge also creates the recurring subscription. The price + interval come
   * from the catalogue; the client never sends an amount.
   *
   * Entitlement is still granted only by the `Pay` webhook (which matches this
   * pending row by `invoiceId`), so this endpoint grants nothing for free — it
   * just makes the SERVER own the invoice + amount instead of the browser.
   *
   * @throws NotFoundException when the plan code is unknown.
   */
  async createPremiumCheckout(userId: string, plan: string): Promise<CheckoutWidgetParams> {
    const found = await this.premium.findPlanByCode(plan);
    if (!found) {
      throw new NotFoundException('Premium plan not found');
    }

    const invoiceId = randomUUID();
    const amount = found.priceRub;

    await this.paymentModel.create({
      userId: new Types.ObjectId(userId),
      provider: 'cloudpayments',
      invoiceId,
      amount,
      currency: this.currency,
      status: 'pending',
      purpose: 'premium',
      plan: found.code,
    });

    const data: CheckoutData = {
      purpose: 'premium',
      plan: found.code,
      userId,
      // The recurrent descriptor turns the first charge into a subscription.
      cloudPayments: { recurrent: this.planToRecurrent(found.intervalDays) },
    };

    return {
      publicId: this.publicId,
      invoiceId,
      amount,
      currency: this.currency,
      accountId: userId,
      description: `${found.title} (${found.code})`,
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

    // Defence-in-depth: a tombstoned (`deletedAt`) / banned account must never be
    // entitled. Best-effort cancel any upstream subscription so a torn-down card
    // stops being billed, then ack WITHOUT crediting/activating. The Payment is
    // left pending (audit) — it is never fulfilled for a dead account.
    if (await this.isAccountTorndown(payment.userId.toString())) {
      this.logger.warn(
        `Pay for invoice ${payment.invoiceId} refused: account ${payment.userId.toString()} ` +
          'is deleted/banned — not entitling.',
      );
      await this.cancelUpstreamBestEffort(n);
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

    // Re-assert the teardown gate AFTER winning the claim and immediately before
    // fulfilment. The pre-claim check above leaves a window in which an account
    // teardown can commit its tombstone between the gate and the claim; this
    // re-check closes it so a webhook that races teardown can never entitle a
    // dead account. Roll the claim back to pending (audit: never fulfilled for a
    // dead account), best-effort cancel any local premium + upstream subscription
    // so the torn-down card stops being billed, then ack WITHOUT crediting.
    if (await this.isAccountTorndown(claimed.userId.toString())) {
      this.logger.warn(
        `Pay for invoice ${claimed.invoiceId} refused post-claim: account ` +
          `${claimed.userId.toString()} was torn down (deleted/banned) — not entitling.`,
      );
      await this.paymentModel
        .updateOne({ _id: claimed._id }, { $set: { status: 'pending' } })
        .exec();
      await this.premium.cancel(claimed.userId.toString()).catch(() => undefined);
      await this.cancelUpstreamBestEffort(n);
      return ACK_OK;
    }

    try {
      if (claimed.purpose === 'coins') {
        await this.fulfilCoins(claimed);
      } else {
        await this.fulfilPremium(claimed, n.Token ?? undefined, n.SubscriptionId ?? undefined);
      }
    } catch (err) {
      // Roll the claim back to pending so a redelivery can retry fulfilment;
      // surface the error so the guard/controller returns non-200 and triggers
      // CloudPayments' retry.
      await this.paymentModel
        .updateOne({ _id: claimed._id }, { $set: { status: 'pending' } })
        .exec();
      // PAGE signal: a paid buyer was not entitled (rolled back for retry).
      this.emit((m) => m.fulfilmentRolledBack(claimed.purpose));
      this.logger.error(
        `Fulfilment failed for invoice ${claimed.invoiceId}; rolled back to pending: ${
          (err as Error).message
        }`,
      );
      throw err;
    }

    // Fulfilment succeeded: count the completed payment (money-in success signal).
    this.emit((m) => m.paymentCompleted(claimed.purpose));

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
      // Count the charge failure (money-in failure signal).
      this.emit((m) => m.paymentFailed());
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
   * premium for another interval AND record the renewal as a completed Payment
   * row (revenue audit); on any terminal status
   * (`PastDue`/`Cancelled`/`Rejected`/`Expired`) we cancel local entitlement.
   * Keyed by `SubscriptionId` (falling back to invoice). Always ack `0`.
   *
   * CANCELLATION GUARD: if the user has already flagged the subscription to NOT
   * renew (`cancelAtPeriodEnd`), an `Active` renewal is REFUSED — we do not
   * re-activate or re-bill. This is the backstop for a race where a renewal
   * charge lands after the user cancelled (or our upstream cancel didn't take):
   * we cancel local entitlement and, best-effort, ask CloudPayments to cancel
   * the subscription so it stops billing.
   */
  async handleRecurrent(n: CloudPaymentsNotification): Promise<CloudPaymentsAck> {
    const userId = this.userIdFromNotification(n);
    if (!userId) {
      this.logger.warn('Recurrent notification without a resolvable userId');
      return ACK_OK;
    }

    const status = n.Status ?? '';
    if (status === RECURRENT_ACTIVE) {
      // Defence-in-depth: a tombstoned (`deletedAt`) / banned account must never
      // be re-entitled by a renewal charge that landed after teardown. Cancel
      // local entitlement + best-effort upstream cancel so the card stops being
      // billed, then ack WITHOUT activating.
      if (await this.isAccountTorndown(userId)) {
        this.logger.warn(
          `Recurrent Active for user ${userId} ignored: account is deleted/banned. ` +
            'Cancelling upstream.',
        );
        await this.premium.cancel(userId);
        await this.cancelUpstreamBestEffort(n);
        return ACK_OK;
      }

      // Refuse to re-activate a subscription the user has cancelled.
      if (await this.premium.hasCanceledRenewal(userId)) {
        this.logger.warn(
          `Recurrent Active for user ${userId} ignored: subscription is flagged canceled. Cancelling upstream.`,
        );
        await this.premium.cancel(userId);
        await this.cancelUpstreamBestEffort(n);
        return ACK_OK;
      }

      const plan = await this.planFromRecurrent(n, userId);

      // IDEMPOTENCY GATE (P0): claim the renewal by inserting its completed
      // Payment row under a DETERMINISTIC, unique `invoiceId` derived from
      // (subscriptionId, transactionId) BEFORE activating. A concurrent or
      // redelivered `Active` webhook for the SAME charge loses the unique-index
      // race (dup-key) and short-circuits here — so premium is activated, and
      // revenue counted, EXACTLY ONCE per renewal charge.
      const claimed = await this.claimRenewalPayment(n, userId, plan);
      if (!claimed) {
        this.logger.warn(
          `Recurrent Active for user ${userId} is a duplicate (subscription ` +
            `${n.SubscriptionId ?? '(none)'}, tx ${n.TransactionId ?? '(none)'}) — ` +
            'already renewed; skipping re-activation.',
        );
        return ACK_OK;
      }

      // Re-assert the teardown gate AFTER the renewal claim and immediately
      // before activation. The pre-claim check above leaves a window in which an
      // account teardown can commit its tombstone between the gate and the claim;
      // this re-check closes it so a renewal that races teardown can never
      // re-entitle a dead account. Best-effort cancel local premium + upstream
      // subscription so the torn-down card stops being billed, then ack WITHOUT
      // activating (the just-claimed Payment row stays as the revenue/audit record).
      if (await this.isAccountTorndown(userId)) {
        this.logger.warn(
          `Recurrent Active for user ${userId} refused post-claim: account was torn ` +
            'down (deleted/banned) — not re-activating. Cancelling upstream.',
        );
        await this.premium.cancel(userId).catch(() => undefined);
        await this.cancelUpstreamBestEffort(n);
        return ACK_OK;
      }

      const periodEnd = await this.computePeriodEnd(plan);
      await this.premium.activate(
        userId,
        plan,
        periodEnd,
        n.Token ?? undefined,
        n.SubscriptionId ?? undefined,
      );
      // A renewal charge is a completed premium payment (money-in success signal).
      this.emit((m) => m.paymentCompleted('premium'));
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

    // Count the reversal exactly once (the winner of the atomic claim). Emitted
    // here — before the reversal logic below (owned elsewhere) — so it counts
    // every claimed refund regardless of how the clawback resolves.
    this.emit((m) => m.refundRecorded());

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

  /**
   * ADMIN-INITIATED refund of a completed payment by its Payment `_id`. Calls
   * CloudPayments to actually refund the charge, then atomically marks the row
   * `refunded` and reverses fulfilment (debit coins / cancel premium) — the same
   * reversal the `Refund` webhook performs, so the redelivered webhook is a
   * no-op (idempotent on the already-`refunded` status).
   *
   * Order matters: we call the provider FIRST and only mutate local state once
   * the refund succeeded, so a provider rejection leaves the Payment untouched.
   *
   * @returns the refunded amount + provider transaction id (for the audit log).
   * @throws NotFoundException when the payment doesn't exist.
   * @throws BadRequestException when it isn't a completed, refundable charge.
   * @throws ServiceUnavailableException when payments aren't configured.
   * @throws Error when CloudPayments rejects the refund.
   */
  async refundByAdmin(
    paymentId: string,
  ): Promise<{ amount: number; transactionId: number | null }> {
    if (!Types.ObjectId.isValid(paymentId)) {
      throw new NotFoundException('Payment not found');
    }
    const payment = await this.paymentModel.findById(paymentId).exec();
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    if (payment.status === 'refunded') {
      throw new BadRequestException('Payment is already refunded');
    }
    if (payment.status !== 'completed') {
      throw new BadRequestException('Only a completed payment can be refunded');
    }
    if (payment.transactionId === null || payment.transactionId === undefined) {
      throw new BadRequestException('Payment has no provider transaction id to refund');
    }

    // 1) Refund upstream FIRST — if the provider rejects, we never touch state.
    await this.cloudPayments.refundPayment(payment.transactionId, payment.amount);

    // 2) Atomically claim the refund so the reversal runs exactly once even if
    //    the provider's Refund webhook races us.
    const claimed = await this.paymentModel
      .findOneAndUpdate(
        { _id: payment._id, status: 'completed' },
        { $set: { status: 'refunded' } },
        { new: true },
      )
      .exec();

    // 3) Reverse fulfilment (best-effort — the money is already back).
    if (claimed) {
      // Count the reversal once (the winner of the atomic claim). The provider
      // Refund webhook that may follow is idempotent (already-refunded → early
      // return) so it won't double-count.
      this.emit((m) => m.refundRecorded());
      try {
        if (claimed.purpose === 'coins') {
          await this.reverseCoins(claimed);
        } else {
          await this.premium.cancel(claimed.userId.toString());
        }
      } catch (err) {
        this.logger.error(
          `Admin refund reversal issue for invoice ${claimed.invoiceId}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Admin refunded payment ${paymentId} (tx ${payment.transactionId}, amount ${payment.amount})`,
    );
    return { amount: payment.amount, transactionId: payment.transactionId };
  }

  // ── internals ───────────────────────────────────────────────────────────────

  /**
   * Best-effort metric emit. Wraps the (optional) MetricsService so a counter
   * bump can NEVER throw into the payment flow — the money path is authoritative,
   * the metric is a side-effect. No-op when MetricsService isn't wired.
   */
  private emit(fn: (m: MetricsService) => void): void {
    if (!this.metrics) {
      return;
    }
    try {
      fn(this.metrics);
    } catch {
      // a metrics blip must never affect payment processing
    }
  }

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
  private async fulfilPremium(
    payment: PaymentDocument,
    token?: string,
    subscriptionId?: string,
  ): Promise<void> {
    const plan = payment.plan ?? 'monthly';
    const periodEnd = await this.computePeriodEnd(plan);
    await this.premium.activate(payment.userId.toString(), plan, periodEnd, token, subscriptionId);
    this.logger.log(
      `Activated premium (plan ${plan}) for user ${payment.userId.toString()} until ${periodEnd.toISOString()}`,
    );
  }

  /**
   * Reverse previously-credited coins on a refund/chargeback.
   *
   * Uses {@link RefundCapableWallet.reverseRefund} rather than a bare `debit`:
   * the old debit threw `InsufficientFundsException` whenever the buyer had
   * already SPENT the credited coins, and the caller silently swallowed it — so
   * the spent value stayed FREE after a chargeback. `reverseRefund` instead
   * claws back whatever the balance still holds AND records the unrecovered
   * remainder as account debt under an economy hold, which freezes all further
   * spending until the debt is repaid. The hold is the real enforcement; this
   * method just drives it.
   */
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
    const userId = payment.userId.toString();
    // refId namespaced so the refund ledger row is distinct from the purchase.
    const { reversed, owed } = await this.wallet.reverseRefund(
      userId,
      total,
      `refund:${payment.invoiceId}`,
    );
    if (owed > 0) {
      this.logger.warn(
        `Refund of ${total} coins for user ${userId} (invoice ${payment.invoiceId}) only ` +
          `reversed ${reversed}; held ${owed} as debt + froze spending (already-spent value).`,
      );
    } else {
      this.logger.log(
        `Reversed ${total} coins from user ${userId} for refunded invoice ${payment.invoiceId}`,
      );
    }
  }

  /**
   * Locate the Payment a notification refers to, preferring our `InvoiceId`
   * (the idempotency key) and falling back to the provider `TransactionId`.
   */
  private async findByNotification(n: CloudPaymentsNotification): Promise<PaymentDocument | null> {
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
  private async planFromRecurrent(n: CloudPaymentsNotification, _userId: string): Promise<string> {
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
   * Atomically CLAIM a recurring renewal by inserting its `completed` Payment
   * row under a DETERMINISTIC, unique `invoiceId` of the form
   * `renewal:<subscriptionId>:<transactionId>`. This row is both the revenue
   * ledger entry AND the idempotency token: because `invoiceId` is unique
   * (schema index), a concurrent or redelivered `Active` webhook for the SAME
   * charge fails with a duplicate-key error, which we treat as "already renewed"
   * and report by returning `false` — letting {@link handleRecurrent} skip the
   * re-activation. The winner returns `true`.
   *
   * When the provider sends NO `TransactionId` (so we cannot derive a stable
   * key), we fall back to a random invoiceId and always claim (`true`) — a
   * keyless renewal can't be reliably de-duplicated, so we err on the side of
   * honouring the charge rather than dropping a real renewal.
   *
   * Any non-duplicate insert error is logged and treated as a claim (`true`) so
   * a transient ledger hiccup does NOT silently skip a real renewal's
   * activation (the entitlement matters more than the audit row).
   */
  private async claimRenewalPayment(
    n: CloudPaymentsNotification,
    userId: string,
    plan: string,
  ): Promise<boolean> {
    const found = await this.premium.findPlanByCode(plan);
    const amount =
      n.Amount !== undefined && Number.isFinite(n.Amount) ? n.Amount : (found?.priceRub ?? 0);

    try {
      await this.paymentModel.create({
        userId: new Types.ObjectId(userId),
        provider: 'cloudpayments',
        invoiceId: this.renewalInvoiceId(n),
        transactionId: n.TransactionId ?? null,
        subscriptionId: n.SubscriptionId ?? null,
        subscriptionToken: n.Token ?? null,
        amount,
        currency: n.Currency ?? this.currency,
        status: 'completed',
        purpose: 'premium',
        plan: found?.code ?? plan,
        rawPayload: { ...n },
      });
      this.logger.log(
        `Recorded renewal payment for user ${userId} (plan ${plan}, amount ${amount})`,
      );
      return true;
    } catch (err) {
      if (this.isDuplicateKeyError(err)) {
        // A renewal row for this (subscriptionId, transactionId) already exists:
        // a redelivered / concurrent webhook lost the unique-index race.
        return false;
      }
      this.logger.error(
        `Failed to record renewal payment for user ${userId}: ${(err as Error).message}`,
      );
      // Non-duplicate failure: do not drop a real renewal — let activation proceed.
      return true;
    }
  }

  /**
   * Deterministic, unique invoice id for a recurring renewal charge, derived
   * from `(SubscriptionId, TransactionId)` so the same charge always maps to the
   * same key (and thus de-duplicates via the `invoiceId` unique index). When the
   * provider omits `TransactionId` we cannot build a stable key, so we fall back
   * to a random UUID (no reliable de-dup possible for a keyless renewal).
   */
  private renewalInvoiceId(n: CloudPaymentsNotification): string {
    if (n.TransactionId !== undefined && n.TransactionId !== null) {
      return `renewal:${n.SubscriptionId ?? 'sub'}:${n.TransactionId}`;
    }
    return `renewal:${n.SubscriptionId ?? 'sub'}:${randomUUID()}`;
  }

  /** True for a MongoDB duplicate-key error (code 11000 / E11000). */
  private isDuplicateKeyError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) {
      return false;
    }
    const code = (err as { code?: number | string }).code;
    const message = (err as { message?: string }).message ?? '';
    return code === 11000 || code === 11001 || /E11000 duplicate key/i.test(message);
  }

  /**
   * Defence-in-depth tombstone/ban gate: resolve the `users` row and report
   * whether the account is TORN-DOWN (`deletedAt != null`) or BANNED
   * (`isBanned === true`). Such an account must NEVER be (re-)entitled by a
   * webhook — a renewal charge or redelivered Pay landing after teardown could
   * otherwise resurrect premium/coins on a dead account.
   *
   * Reads the `users` collection by name via the shared connection (same
   * read-by-name pattern the economy services use). Fails OPEN when the
   * connection is unavailable or the read errors (the amount + idempotency
   * guards remain the primary defence), and treats an UNKNOWN userId as
   * not-dead so a legitimate buyer is never blocked by a transient miss.
   */
  private async isAccountTorndown(userId: string): Promise<boolean> {
    if (!this.connection || !Types.ObjectId.isValid(userId)) {
      return false;
    }
    try {
      const row = (await this.connection
        .collection('users')
        .findOne(
          { _id: new Types.ObjectId(userId) },
          { projection: { deletedAt: 1, isBanned: 1 } },
        )) as { deletedAt?: Date | null; isBanned?: boolean } | null;
      if (!row) {
        return false;
      }
      return row.deletedAt != null || row.isBanned === true;
    } catch (err) {
      this.logger.warn(
        `Failed to check teardown state for user ${userId}; failing open: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Best-effort cancel of the upstream CloudPayments subscription referenced by
   * a notification (used when we refuse a renewal for an already-cancelled
   * subscription). Never throws — purely a backstop.
   */
  private async cancelUpstreamBestEffort(n: CloudPaymentsNotification): Promise<void> {
    if (!n.SubscriptionId || !this.cloudPayments.isConfigured()) {
      return;
    }
    try {
      await this.cloudPayments.cancelSubscription(n.SubscriptionId);
    } catch (err) {
      this.logger.error(
        `Best-effort upstream cancel of subscription ${n.SubscriptionId} failed: ${
          (err as Error).message
        }`,
      );
    }
  }

  /**
   * Map a plan's `intervalDays` to the CloudPayments recurrent descriptor placed
   * under `data.cloudPayments.recurrent` (mirrors the web `planToRecurrent`).
   */
  private planToRecurrent(intervalDays: number): {
    interval: 'Day' | 'Week' | 'Month';
    period: number;
  } {
    if (intervalDays % 30 === 0) {
      return { interval: 'Month', period: Math.max(1, Math.round(intervalDays / 30)) };
    }
    if (intervalDays % 7 === 0) {
      return { interval: 'Week', period: Math.max(1, Math.round(intervalDays / 7)) };
    }
    return { interval: 'Day', period: Math.max(1, intervalDays) };
  }

  /**
   * Compute the end of a freshly-paid period from the plan's `intervalDays`
   * (via the premium catalogue, defaulting to 30 days when unavailable),
   * measured from now.
   */
  private async computePeriodEnd(plan: string): Promise<Date> {
    let intervalDays = 30;
    const found = await this.premium.findPlanByCode(plan);
    if (found && Number.isFinite(found.intervalDays) && found.intervalDays > 0) {
      intervalDays = found.intervalDays;
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
