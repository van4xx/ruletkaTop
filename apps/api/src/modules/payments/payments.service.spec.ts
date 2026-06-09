import { createHmac } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';

import { CloudPaymentsClient } from './cloudpayments.client';
import { CloudPaymentsSignatureGuard } from './cloudpayments-signature.guard';
import { COIN_PACKAGES_SERVICE, PREMIUM_SERVICE, WALLET_SERVICE } from './payments.contracts';
import { PaymentsService } from './payments.service';
import { Payment } from './schemas/payment.schema';

/** Build an `exec()`-terminated query stub resolving to `result`. */
function queryReturning(result: unknown): { exec: jest.Mock } {
  return { exec: jest.fn().mockResolvedValue(result) };
}

/** Build a query stub supporting `.sort().exec()` (used by Recurrent lookup). */
function sortableQueryReturning(result: unknown): {
  sort: jest.Mock;
  exec: jest.Mock;
} {
  const stub = {
    sort: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(result),
  };
  return stub;
}

const SECRET = 'test-api-secret';

describe('CloudPaymentsSignatureGuard — Content-HMAC verification', () => {
  function guardFor(secret: string): CloudPaymentsSignatureGuard {
    const config = { get: jest.fn().mockReturnValue(secret) } as unknown as ConfigService;
    return new CloudPaymentsSignatureGuard(config);
  }

  function contextWith(
    rawBody: Buffer | undefined,
    headers: Record<string, string>,
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ rawBody, headers }),
      }),
    } as unknown as ExecutionContext;
  }

  /** The base64 HMAC-SHA256 CloudPayments would send for `body` under `secret`. */
  function sign(body: string, secret: string): string {
    return createHmac('sha256', secret).update(Buffer.from(body)).digest('base64');
  }

  it('accepts a request whose Content-HMAC matches the raw body', () => {
    const body = 'TransactionId=42&Amount=99&InvoiceId=inv-1';
    const guard = guardFor(SECRET);
    const ctx = contextWith(Buffer.from(body), { 'content-hmac': sign(body, SECRET) });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('accepts the legacy X-Content-HMAC header spelling', () => {
    const body = 'InvoiceId=inv-2';
    const guard = guardFor(SECRET);
    const ctx = contextWith(Buffer.from(body), { 'x-content-hmac': sign(body, SECRET) });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects a tampered body (signature no longer matches)', () => {
    const signed = sign('Amount=99', SECRET);
    const guard = guardFor(SECRET);
    // Body differs from what was signed ⇒ recomputed digest mismatches.
    const ctx = contextWith(Buffer.from('Amount=9900'), { 'content-hmac': signed });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a signature made with the wrong secret', () => {
    const body = 'InvoiceId=inv-3';
    const guard = guardFor(SECRET);
    const ctx = contextWith(Buffer.from(body), { 'content-hmac': sign(body, 'other-secret') });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects when the Content-HMAC header is missing', () => {
    const guard = guardFor(SECRET);
    const ctx = contextWith(Buffer.from('InvoiceId=inv-4'), {});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects when the raw body is unavailable', () => {
    const guard = guardFor(SECRET);
    const ctx = contextWith(undefined, { 'content-hmac': 'whatever' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('fails closed when no secret is configured', () => {
    const body = 'InvoiceId=inv-5';
    const guard = guardFor('');
    const ctx = contextWith(Buffer.from(body), { 'content-hmac': sign(body, '') });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});

describe('PaymentsService — Pay idempotency (double webhook → single credit)', () => {
  const userId = '507f1f77bcf86cd799439011';
  const invoiceId = 'inv-pay-1';

  let service: PaymentsService;
  let paymentModel: {
    findOne: jest.Mock;
    findById: jest.Mock;
    findOneAndUpdate: jest.Mock;
    updateOne: jest.Mock;
    create: jest.Mock;
  };
  let wallet: { credit: jest.Mock; debit: jest.Mock; getBalance: jest.Mock };
  let premium: {
    activate: jest.Mock;
    cancel: jest.Mock;
    isPremium: jest.Mock;
    hasCanceledRenewal: jest.Mock;
    findPlanByCode: jest.Mock;
  };
  let coinPackages: { findByCode: jest.Mock };
  let cloudPayments: { isConfigured: jest.Mock; cancelSubscription: jest.Mock; refundPayment: jest.Mock };

  beforeEach(async () => {
    wallet = {
      credit: jest.fn().mockResolvedValue(600),
      debit: jest.fn().mockResolvedValue(0),
      getBalance: jest.fn().mockResolvedValue(0),
    };
    premium = {
      activate: jest.fn().mockResolvedValue(undefined),
      cancel: jest.fn().mockResolvedValue(undefined),
      isPremium: jest.fn().mockResolvedValue(false),
      hasCanceledRenewal: jest.fn().mockResolvedValue(false),
      findPlanByCode: jest.fn().mockResolvedValue({
        code: 'monthly',
        title: 'Premium Monthly',
        priceRub: 399,
        intervalDays: 30,
        perks: [],
      }),
    };
    coinPackages = {
      // 500 + 100 bonus = 600 coins, priced at 449 RUB.
      findByCode: jest.fn().mockResolvedValue({
        code: 'coins_550',
        coins: 500,
        bonusCoins: 100,
        priceRub: 449,
      }),
    };
    cloudPayments = {
      isConfigured: jest.fn().mockReturnValue(false),
      cancelSubscription: jest.fn().mockResolvedValue(undefined),
      refundPayment: jest.fn().mockResolvedValue(undefined),
    };

    paymentModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockReturnValue(queryReturning({ acknowledged: true })),
      create: jest.fn().mockResolvedValue({ _id: 'created' }),
    };

    const config = {
      get: jest.fn((key: string, def?: unknown) =>
        key === 'CLOUDPAYMENTS_PUBLIC_ID' ? 'pk_test' : def,
      ),
    } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getModelToken(Payment.name), useValue: paymentModel },
        { provide: ConfigService, useValue: config },
        { provide: WALLET_SERVICE, useValue: wallet },
        { provide: PREMIUM_SERVICE, useValue: premium },
        { provide: COIN_PACKAGES_SERVICE, useValue: coinPackages },
        { provide: CloudPaymentsClient, useValue: cloudPayments },
      ],
    }).compile();

    service = moduleRef.get(PaymentsService);
  });

  it('credits coins exactly once across two identical Pay webhooks', async () => {
    const notification = {
      InvoiceId: invoiceId,
      TransactionId: 4242,
      Amount: 449,
      AccountId: userId,
    };

    // FIRST delivery: payment is pending; the atomic pending→completed claim wins.
    // SECOND delivery: findByNotification sees it already completed → no-op.
    paymentModel.findOne
      .mockReturnValueOnce(
        queryReturning({
          _id: 'pay1',
          invoiceId,
          status: 'pending',
          purpose: 'coins',
          packageCode: 'coins_550',
          amount: 449,
          userId: { toString: () => userId },
        }),
      )
      .mockReturnValueOnce(
        queryReturning({
          _id: 'pay1',
          invoiceId,
          status: 'completed',
          purpose: 'coins',
          packageCode: 'coins_550',
          amount: 449,
          userId: { toString: () => userId },
        }),
      );

    // The claim only succeeds for the winner (first call); a hypothetical second
    // claim attempt would match nothing. We model that explicitly.
    paymentModel.findOneAndUpdate
      .mockReturnValueOnce(
        queryReturning({
          _id: 'pay1',
          invoiceId,
          status: 'completed',
          purpose: 'coins',
          packageCode: 'coins_550',
          amount: 449,
          userId: { toString: () => userId },
        }),
      )
      .mockReturnValue(queryReturning(null));

    const ack1 = await service.handlePay(notification);
    const ack2 = await service.handlePay(notification);

    expect(ack1).toEqual({ code: 0 });
    expect(ack2).toEqual({ code: 0 });

    // The critical invariant: a single credit of 600 coins (500 + 100 bonus),
    // keyed by the invoiceId, despite two webhook deliveries.
    expect(wallet.credit).toHaveBeenCalledTimes(1);
    expect(wallet.credit).toHaveBeenCalledWith(userId, 600, 'purchase', invoiceId);

    // The pending→completed claim was attempted once (only the first delivery
    // saw a pending payment); the second short-circuited on the completed status.
    expect(paymentModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [claimFilter] = paymentModel.findOneAndUpdate.mock.calls[0] as [Record<string, unknown>];
    expect(claimFilter).toMatchObject({ status: 'pending' });
  });

  it('does not credit when the Pay amount differs from the stored price', async () => {
    paymentModel.findOne.mockReturnValue(
      queryReturning({
        _id: 'pay2',
        invoiceId,
        status: 'pending',
        purpose: 'coins',
        packageCode: 'coins_550',
        amount: 449,
        userId: { toString: () => userId },
      }),
    );

    // Attacker-controlled smaller amount must NOT fulfil.
    const ack = await service.handlePay({
      InvoiceId: invoiceId,
      TransactionId: 1,
      Amount: 1,
      AccountId: userId,
    });

    expect(ack).toEqual({ code: 0 });
    expect(wallet.credit).not.toHaveBeenCalled();
    expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('activates premium exactly once on a Pay for a premium payment', async () => {
    paymentModel.findOne.mockReturnValueOnce(
      queryReturning({
        _id: 'pay3',
        invoiceId: 'inv-prem-1',
        status: 'pending',
        purpose: 'premium',
        plan: 'monthly',
        amount: 399,
        userId: { toString: () => userId },
      }),
    );
    paymentModel.findOneAndUpdate.mockReturnValueOnce(
      queryReturning({
        _id: 'pay3',
        invoiceId: 'inv-prem-1',
        status: 'completed',
        purpose: 'premium',
        plan: 'monthly',
        amount: 399,
        userId: { toString: () => userId },
      }),
    );

    const ack = await service.handlePay({
      InvoiceId: 'inv-prem-1',
      TransactionId: 7,
      Amount: 399,
      Token: 'tok_recurring',
      AccountId: userId,
    });

    expect(ack).toEqual({ code: 0 });
    expect(premium.activate).toHaveBeenCalledTimes(1);
    const [actUser, actPlan, , actToken] = premium.activate.mock.calls[0] as [
      string,
      string,
      Date,
      string,
    ];
    expect(actUser).toBe(userId);
    expect(actPlan).toBe('monthly');
    expect(actToken).toBe('tok_recurring');
  });

  it('renews premium on a Recurrent "Active" notification', async () => {
    // No prior premium payment by SubscriptionId; plan falls back via Data.
    paymentModel.findOne.mockReturnValue(sortableQueryReturning(null));

    const ack = await service.handleRecurrent({
      SubscriptionId: 'sc_1',
      AccountId: userId,
      Status: 'Active',
      Token: 'tok_recurring',
      Data: JSON.stringify({ purpose: 'premium', plan: 'monthly', userId }),
    });

    expect(ack).toEqual({ code: 0 });
    expect(premium.activate).toHaveBeenCalledTimes(1);
    expect(premium.cancel).not.toHaveBeenCalled();
  });

  it('activates premium EXACTLY ONCE across a redelivered Recurrent "Active" (dup-key claim)', async () => {
    // planFromRecurrent lookup returns null on every call (plan via Data).
    paymentModel.findOne.mockReturnValue(sortableQueryReturning(null));

    // The renewal Payment row carries a DETERMINISTIC unique invoiceId derived
    // from (SubscriptionId, TransactionId). The first claim inserts it; the
    // redelivered webhook's insert hits the unique index and throws E11000.
    const dupKeyErr = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    paymentModel.create
      .mockResolvedValueOnce({ _id: 'renewal-1' })
      .mockRejectedValueOnce(dupKeyErr);

    const notification = {
      SubscriptionId: 'sc_dup',
      TransactionId: 9100,
      Amount: 399,
      AccountId: userId,
      Status: 'Active',
      Token: 'tok',
      Data: JSON.stringify({ purpose: 'premium', plan: 'monthly', userId }),
    };

    const ack1 = await service.handleRecurrent(notification);
    const ack2 = await service.handleRecurrent(notification);

    expect(ack1).toEqual({ code: 0 });
    expect(ack2).toEqual({ code: 0 });

    // Critical invariant: premium activated (and revenue counted) exactly ONCE
    // despite two identical Recurrent deliveries.
    expect(premium.activate).toHaveBeenCalledTimes(1);
    expect(paymentModel.create).toHaveBeenCalledTimes(2); // both attempted to claim
    // The claimed renewal row uses the deterministic (sub, tx) invoiceId.
    const [firstRow] = paymentModel.create.mock.calls[0] as [Record<string, unknown>];
    expect(firstRow).toMatchObject({
      invoiceId: 'renewal:sc_dup:9100',
      status: 'completed',
      purpose: 'premium',
    });
  });

  it('claims renewal BEFORE activating: a dup-key claim skips activation entirely', async () => {
    paymentModel.findOne.mockReturnValue(sortableQueryReturning(null));
    const dupKeyErr = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    paymentModel.create.mockRejectedValueOnce(dupKeyErr);

    const ack = await service.handleRecurrent({
      SubscriptionId: 'sc_x',
      TransactionId: 7,
      Amount: 399,
      AccountId: userId,
      Status: 'Active',
      Data: JSON.stringify({ purpose: 'premium', plan: 'monthly', userId }),
    });

    expect(ack).toEqual({ code: 0 });
    // Lost the claim race ⇒ no activation, no revenue double-count.
    expect(premium.activate).not.toHaveBeenCalled();
  });

  it('cancels premium on a Recurrent terminal status', async () => {
    const ack = await service.handleRecurrent({
      SubscriptionId: 'sc_1',
      AccountId: userId,
      Status: 'Cancelled',
    });

    expect(ack).toEqual({ code: 0 });
    expect(premium.cancel).toHaveBeenCalledWith(userId);
    expect(premium.activate).not.toHaveBeenCalled();
  });

  it('approves a valid Check (pending invoice, matching amount) with ack 0', async () => {
    paymentModel.findOne.mockReturnValue(
      queryReturning({ invoiceId, status: 'pending', amount: 449 }),
    );
    const ack = await service.handleCheck({ InvoiceId: invoiceId, Amount: 449 });
    expect(ack).toEqual({ code: 0 });
  });

  it('declines a Check for an unknown invoice', async () => {
    paymentModel.findOne.mockReturnValue(queryReturning(null));
    const ack = await service.handleCheck({ InvoiceId: 'nope', Amount: 449 });
    expect(ack).toEqual({ code: 11 });
  });

  it('REFUSES a Recurrent "Active" renewal when the user has cancelled', async () => {
    premium.hasCanceledRenewal.mockResolvedValue(true);
    cloudPayments.isConfigured.mockReturnValue(true);

    const ack = await service.handleRecurrent({
      SubscriptionId: 'sc_9',
      AccountId: userId,
      Status: 'Active',
      Token: 'tok',
      Data: JSON.stringify({ purpose: 'premium', plan: 'monthly', userId }),
    });

    expect(ack).toEqual({ code: 0 });
    // No re-activation; we cancel locally + ask CloudPayments to stop billing.
    expect(premium.activate).not.toHaveBeenCalled();
    expect(premium.cancel).toHaveBeenCalledWith(userId);
    expect(cloudPayments.cancelSubscription).toHaveBeenCalledWith('sc_9');
  });

  it('records a renewal as a completed Payment on Recurrent "Active"', async () => {
    // planFromRecurrent lookup (sortable) + dedupe lookup (select/exec) both null.
    paymentModel.findOne
      .mockReturnValueOnce(sortableQueryReturning(null)) // planFromRecurrent
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      }); // dedupe by transactionId

    await service.handleRecurrent({
      SubscriptionId: 'sc_1',
      TransactionId: 555,
      Amount: 399,
      AccountId: userId,
      Status: 'Active',
      Token: 'tok',
      Data: JSON.stringify({ purpose: 'premium', plan: 'monthly', userId }),
    });

    // A completed premium Payment row was written for the renewal.
    expect(paymentModel.create).toHaveBeenCalledTimes(1);
    const [row] = paymentModel.create.mock.calls[0] as [Record<string, unknown>];
    expect(row).toMatchObject({
      status: 'completed',
      purpose: 'premium',
      plan: 'monthly',
      amount: 399,
      transactionId: 555,
    });
  });

  it('admin refund: calls CloudPayments, marks refunded, reverses fulfilment', async () => {
    paymentModel.findById.mockReturnValue(
      queryReturning({
        _id: 'pay-r',
        invoiceId: 'inv-r',
        status: 'completed',
        purpose: 'coins',
        packageCode: 'coins_550',
        amount: 449,
        transactionId: 9001,
        userId: { toString: () => userId },
      }),
    );
    paymentModel.findOneAndUpdate.mockReturnValue(
      queryReturning({
        _id: 'pay-r',
        invoiceId: 'inv-r',
        status: 'refunded',
        purpose: 'coins',
        packageCode: 'coins_550',
        amount: 449,
        userId: { toString: () => userId },
      }),
    );

    const result = await service.refundByAdmin('507f1f77bcf86cd799439011');

    expect(cloudPayments.refundPayment).toHaveBeenCalledWith(9001, 449);
    expect(result).toEqual({ amount: 449, transactionId: 9001 });
    // Coins reversal debits the credited total back out.
    expect(wallet.debit).toHaveBeenCalledWith(userId, 600, 'refund', 'refund:inv-r');
  });

  it('admin refund: rejects a non-completed payment and never calls the provider', async () => {
    paymentModel.findById.mockReturnValue(
      queryReturning({
        _id: 'pay-p',
        status: 'pending',
        purpose: 'coins',
        amount: 449,
        transactionId: 1,
        userId: { toString: () => userId },
      }),
    );

    await expect(service.refundByAdmin('507f1f77bcf86cd799439011')).rejects.toThrow();
    expect(cloudPayments.refundPayment).not.toHaveBeenCalled();
  });
});

describe('PaymentsService — tombstone/ban guard (a dead account is never re-entitled)', () => {
  const userId = '507f1f77bcf86cd799439011';
  const invoiceId = 'inv-dead-1';

  let service: PaymentsService;
  let paymentModel: {
    findOne: jest.Mock;
    findById: jest.Mock;
    findOneAndUpdate: jest.Mock;
    updateOne: jest.Mock;
    create: jest.Mock;
  };
  let wallet: { credit: jest.Mock; debit: jest.Mock; getBalance: jest.Mock };
  let premium: {
    activate: jest.Mock;
    cancel: jest.Mock;
    isPremium: jest.Mock;
    hasCanceledRenewal: jest.Mock;
    findPlanByCode: jest.Mock;
  };
  let coinPackages: { findByCode: jest.Mock };
  let cloudPayments: {
    isConfigured: jest.Mock;
    cancelSubscription: jest.Mock;
    refundPayment: jest.Mock;
  };
  /** `users.findOne(...)` result — the tombstone/ban source-of-truth row. */
  let userRow: { deletedAt?: Date | null; isBanned?: boolean } | null;

  /** Build the service with a `users` collection returning `userRow`. */
  async function build(): Promise<void> {
    const connection = {
      collection: jest.fn(() => ({
        findOne: jest.fn().mockImplementation(() => Promise.resolve(userRow)),
      })),
    };
    const config = {
      get: jest.fn((key: string, def?: unknown) =>
        key === 'CLOUDPAYMENTS_PUBLIC_ID' ? 'pk_test' : def,
      ),
    } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getModelToken(Payment.name), useValue: paymentModel },
        { provide: ConfigService, useValue: config },
        { provide: WALLET_SERVICE, useValue: wallet },
        { provide: PREMIUM_SERVICE, useValue: premium },
        { provide: COIN_PACKAGES_SERVICE, useValue: coinPackages },
        { provide: CloudPaymentsClient, useValue: cloudPayments },
        { provide: getConnectionToken(), useValue: connection },
      ],
    }).compile();
    service = moduleRef.get(PaymentsService);
  }

  beforeEach(async () => {
    wallet = {
      credit: jest.fn().mockResolvedValue(600),
      debit: jest.fn().mockResolvedValue(0),
      getBalance: jest.fn().mockResolvedValue(0),
    };
    premium = {
      activate: jest.fn().mockResolvedValue(undefined),
      cancel: jest.fn().mockResolvedValue(undefined),
      isPremium: jest.fn().mockResolvedValue(false),
      hasCanceledRenewal: jest.fn().mockResolvedValue(false),
      findPlanByCode: jest.fn().mockResolvedValue({
        code: 'monthly',
        title: 'Premium Monthly',
        priceRub: 399,
        intervalDays: 30,
        perks: [],
      }),
    };
    coinPackages = {
      findByCode: jest.fn().mockResolvedValue({
        code: 'coins_550',
        coins: 500,
        bonusCoins: 100,
        priceRub: 449,
      }),
    };
    cloudPayments = {
      isConfigured: jest.fn().mockReturnValue(true),
      cancelSubscription: jest.fn().mockResolvedValue(undefined),
      refundPayment: jest.fn().mockResolvedValue(undefined),
    };
    paymentModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockReturnValue(queryReturning({ acknowledged: true })),
      create: jest.fn().mockResolvedValue({ _id: 'created' }),
    };
    userRow = null;
  });

  it('Pay: REFUSES to credit a coins purchase for a tombstoned (deletedAt) account', async () => {
    userRow = { deletedAt: new Date(), isBanned: true };
    await build();

    paymentModel.findOne.mockReturnValue(
      queryReturning({
        _id: 'pay-dead',
        invoiceId,
        status: 'pending',
        purpose: 'coins',
        packageCode: 'coins_550',
        amount: 449,
        userId: { toString: () => userId },
      }),
    );

    const ack = await service.handlePay({
      InvoiceId: invoiceId,
      TransactionId: 4242,
      Amount: 449,
      SubscriptionId: 'sc_dead',
      AccountId: userId,
    });

    // Ack so CloudPayments stops retrying, but NO credit + NO pending→completed claim.
    expect(ack).toEqual({ code: 0 });
    expect(wallet.credit).not.toHaveBeenCalled();
    expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled();
    // Best-effort upstream cancel so a torn-down card stops being billed.
    expect(cloudPayments.cancelSubscription).toHaveBeenCalledWith('sc_dead');
  });

  it('Recurrent "Active": REFUSES to re-activate premium for a banned account', async () => {
    userRow = { deletedAt: null, isBanned: true };
    await build();
    paymentModel.findOne.mockReturnValue(sortableQueryReturning(null));

    const ack = await service.handleRecurrent({
      SubscriptionId: 'sc_banned',
      TransactionId: 9,
      Amount: 399,
      AccountId: userId,
      Status: 'Active',
      Token: 'tok',
      Data: JSON.stringify({ purpose: 'premium', plan: 'monthly', userId }),
    });

    expect(ack).toEqual({ code: 0 });
    // No re-activation + no revenue claim; local cancel + upstream stop-billing.
    expect(premium.activate).not.toHaveBeenCalled();
    expect(paymentModel.create).not.toHaveBeenCalled();
    expect(premium.cancel).toHaveBeenCalledWith(userId);
    expect(cloudPayments.cancelSubscription).toHaveBeenCalledWith('sc_banned');
  });

  it('Pay: still fulfils for a LIVE account (guard does not block legitimate buyers)', async () => {
    userRow = { deletedAt: null, isBanned: false };
    await build();

    paymentModel.findOne.mockReturnValue(
      queryReturning({
        _id: 'pay-live',
        invoiceId,
        status: 'pending',
        purpose: 'coins',
        packageCode: 'coins_550',
        amount: 449,
        userId: { toString: () => userId },
      }),
    );
    paymentModel.findOneAndUpdate.mockReturnValue(
      queryReturning({
        _id: 'pay-live',
        invoiceId,
        status: 'completed',
        purpose: 'coins',
        packageCode: 'coins_550',
        amount: 449,
        userId: { toString: () => userId },
      }),
    );

    const ack = await service.handlePay({
      InvoiceId: invoiceId,
      TransactionId: 4242,
      Amount: 449,
      AccountId: userId,
    });

    expect(ack).toEqual({ code: 0 });
    expect(wallet.credit).toHaveBeenCalledWith(userId, 600, 'purchase', invoiceId);
  });
});
