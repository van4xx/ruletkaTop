import { createHmac } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';

import { CloudPaymentsSignatureGuard } from './cloudpayments-signature.guard';
import {
  COIN_PACKAGES_SERVICE,
  PREMIUM_SERVICE,
  WALLET_SERVICE,
} from './payments.contracts';
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
    findOneAndUpdate: jest.Mock;
    updateOne: jest.Mock;
    create: jest.Mock;
  };
  let wallet: { credit: jest.Mock; debit: jest.Mock; getBalance: jest.Mock };
  let premium: { activate: jest.Mock; cancel: jest.Mock; isPremium: jest.Mock };
  let coinPackages: { findByCode: jest.Mock };

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

    paymentModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockReturnValue(queryReturning({ acknowledged: true })),
      create: jest.fn(),
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
    const [claimFilter] = paymentModel.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
    ];
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
});
