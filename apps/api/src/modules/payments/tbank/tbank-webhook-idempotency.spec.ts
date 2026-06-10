import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import type { TbankNotification } from '@ruletka/shared-types';

import { CloudPaymentsClient } from '../cloudpayments.client';
import {
  COIN_PACKAGES_SERVICE,
  PREMIUM_SERVICE,
  WALLET_SERVICE,
} from '../payments.contracts';
import { PaymentsService } from '../payments.service';
import { Payment } from '../schemas/payment.schema';

function queryReturning(result: unknown): { exec: jest.Mock } {
  return { exec: jest.fn().mockResolvedValue(result) };
}

describe('PaymentsService.handleTbankWebhook — idempotency on replays', () => {
  const userId = '507f1f77bcf86cd799439011';
  const orderId = 'order-tbank-1';

  let service: PaymentsService;
  let paymentModel: {
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    updateOne: jest.Mock;
    create: jest.Mock;
    findById: jest.Mock;
  };
  let wallet: {
    credit: jest.Mock;
    debit: jest.Mock;
    getBalance: jest.Mock;
    reverseRefund: jest.Mock;
  };
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

  beforeEach(async () => {
    wallet = {
      credit: jest.fn().mockResolvedValue(600),
      debit: jest.fn().mockResolvedValue(0),
      getBalance: jest.fn().mockResolvedValue(0),
      reverseRefund: jest.fn().mockResolvedValue({ reversed: 600, owed: 0 }),
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
      isConfigured: jest.fn().mockReturnValue(false),
      cancelSubscription: jest.fn().mockResolvedValue(undefined),
      refundPayment: jest.fn().mockResolvedValue(undefined),
    };
    paymentModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockReturnValue(queryReturning({ acknowledged: true })),
      create: jest.fn().mockResolvedValue({ _id: 'created' }),
      findById: jest.fn(),
    };

    const config = {
      get: jest.fn((key: string, def?: unknown) => {
        if (key === 'PAYMENT_PROVIDER') return 'tbank';
        if (key === 'CLOUDPAYMENTS_PUBLIC_ID') return 'pk_test';
        return def;
      }),
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

  function buildConfirmed(): TbankNotification {
    return {
      TerminalKey: 'TK',
      OrderId: orderId,
      Success: true,
      Status: 'CONFIRMED',
      PaymentId: 'p-100',
      Amount: 44900,
      Token: 'x',
    } as TbankNotification;
  }

  it('credits coins EXACTLY ONCE across two identical CONFIRMED webhooks', async () => {
    // FIRST delivery: payment is pending; claim wins.
    // SECOND delivery: status already completed; short-circuits with audit only.
    paymentModel.findOne
      .mockReturnValueOnce(
        queryReturning({
          _id: 'pay-tb',
          invoiceId: orderId,
          status: 'pending',
          purpose: 'coins',
          packageCode: 'coins_550',
          amount: 449,
          userId: { toString: () => userId },
        }),
      )
      .mockReturnValueOnce(
        queryReturning({
          _id: 'pay-tb',
          invoiceId: orderId,
          status: 'completed',
          purpose: 'coins',
          packageCode: 'coins_550',
          amount: 449,
          userId: { toString: () => userId },
        }),
      );
    paymentModel.findOneAndUpdate.mockReturnValueOnce(
      queryReturning({
        _id: 'pay-tb',
        invoiceId: orderId,
        status: 'completed',
        purpose: 'coins',
        packageCode: 'coins_550',
        amount: 449,
        userId: { toString: () => userId },
      }),
    );

    await service.handleTbankWebhook(buildConfirmed());
    await service.handleTbankWebhook(buildConfirmed());

    // The critical invariant: a single credit of 600 coins (500 + 100 bonus),
    // keyed by the orderId (= invoiceId), despite two webhook deliveries.
    expect(wallet.credit).toHaveBeenCalledTimes(1);
    expect(wallet.credit).toHaveBeenCalledWith(userId, 600, 'purchase', orderId);
    // The pending→completed claim was attempted once (the second delivery
    // short-circuited on the already-completed status).
    expect(paymentModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not credit when the CONFIRMED amount disagrees with the stored price', async () => {
    paymentModel.findOne.mockReturnValueOnce(
      queryReturning({
        _id: 'pay-tb',
        invoiceId: orderId,
        status: 'pending',
        purpose: 'coins',
        packageCode: 'coins_550',
        amount: 449,
        userId: { toString: () => userId },
      }),
    );

    const n = buildConfirmed();
    n.Amount = 1; // attacker-controlled smaller amount in kopecks
    await service.handleTbankWebhook(n);
    expect(wallet.credit).not.toHaveBeenCalled();
    expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('marks REJECTED only once (idempotent fail)', async () => {
    paymentModel.findOne.mockReturnValueOnce(
      queryReturning({
        _id: 'pay-tb',
        invoiceId: orderId,
        status: 'pending',
        purpose: 'coins',
        amount: 449,
        userId: { toString: () => userId },
      }),
    );
    const rejected: TbankNotification = {
      TerminalKey: 'TK',
      OrderId: orderId,
      Success: false,
      Status: 'REJECTED',
      PaymentId: 'p-100',
      Token: 'x',
    } as TbankNotification;
    await service.handleTbankWebhook(rejected);

    expect(paymentModel.updateOne).toHaveBeenCalled();
    const setCall = paymentModel.updateOne.mock.calls[0][1] as { $set: { status?: string } };
    expect(setCall.$set.status).toBe('failed');
  });
});
