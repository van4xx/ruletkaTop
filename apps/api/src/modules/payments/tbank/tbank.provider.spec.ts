import { ConfigService } from '@nestjs/config';

import { TbankClient } from './tbank.client';
import { TbankProvider } from './tbank.provider';

/** Build a TbankProvider with a stubbed client that captures `init` calls. */
function buildProvider(initImpl: jest.Mock): {
  provider: TbankProvider;
  initSpy: jest.Mock;
} {
  const client = {
    init: initImpl,
    refund: jest.fn().mockResolvedValue({ Success: true }),
    cancel: jest.fn().mockResolvedValue({ Success: true }),
    getState: jest.fn().mockResolvedValue({ Success: true, Status: 'CONFIRMED' }),
    charge: jest.fn().mockResolvedValue({ Success: true, PaymentId: 'p99', Status: 'CONFIRMED' }),
    isConfigured: jest.fn().mockReturnValue(true),
  } as unknown as TbankClient;
  const config = {
    get: jest.fn().mockImplementation((_k: string, def?: string) => def ?? ''),
  } as unknown as ConfigService;
  const provider = new TbankProvider(client, config);
  return { provider, initSpy: initImpl };
}

describe('TbankProvider.createCheckout', () => {
  it('sends a correctly-shaped payload and surfaces the PaymentURL/PaymentId', async () => {
    const initSpy = jest.fn().mockResolvedValue({
      Success: true,
      PaymentId: 'pay-42',
      PaymentURL: 'https://securepay.tinkoff.ru/order/abc',
      OrderId: 'order-1',
    });
    const { provider } = buildProvider(initSpy);

    const result = await provider.createCheckout({
      purpose: 'coins',
      userId: 'u1',
      amountKopecks: 19900,
      currency: 'RUB',
      orderId: 'order-1',
      description: '550 coins',
    });

    expect(result.paymentUrl).toBe('https://securepay.tinkoff.ru/order/abc');
    expect(result.providerPaymentId).toBe('pay-42');
    expect(result.orderId).toBe('order-1');
    // The client was asked to Init with kopecks INTEGER + the orderId echo.
    const args = initSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(args.amountKopecks).toBe(19900);
    expect(args.orderId).toBe('order-1');
    expect(args.customerKey).toBe('u1');
  });

  it('asks for Recurrent when recurrent.enabled is true (premium subscriptions)', async () => {
    const initSpy = jest.fn().mockResolvedValue({
      Success: true,
      PaymentId: 'p1',
      PaymentURL: 'u',
      OrderId: 'o1',
    });
    const { provider } = buildProvider(initSpy);
    await provider.createCheckout({
      purpose: 'premium',
      userId: 'u1',
      amountKopecks: 39900,
      currency: 'RUB',
      orderId: 'o1',
      description: 'Premium Monthly',
      recurrent: { enabled: true, intervalDays: 30 },
    });
    const args = initSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(args.recurrent).toBe(true);
  });

  it('rejects a non-integer / negative amount at the boundary', async () => {
    const initSpy = jest.fn();
    const { provider } = buildProvider(initSpy);
    await expect(
      provider.createCheckout({
        purpose: 'coins',
        userId: 'u',
        amountKopecks: 99.5 as unknown as number,
        currency: 'RUB',
        orderId: 'o',
        description: 'd',
      }),
    ).rejects.toThrow(/INTEGER/);
    expect(initSpy).not.toHaveBeenCalled();
  });

  it('throws on a provider Success:false response', async () => {
    const initSpy = jest.fn().mockResolvedValue({ Success: false, ErrorCode: '53' });
    const { provider } = buildProvider(initSpy);
    await expect(
      provider.createCheckout({
        purpose: 'coins',
        userId: 'u',
        amountKopecks: 100,
        currency: 'RUB',
        orderId: 'o',
        description: 'd',
      }),
    ).rejects.toThrow(/T-Bank Init failed/);
  });
});

describe('TbankProvider.mapStatus', () => {
  it('CONFIRMED / AUTHORIZED → completed', () => {
    expect(TbankProvider.mapStatus('CONFIRMED')).toBe('completed');
    expect(TbankProvider.mapStatus('AUTHORIZED')).toBe('completed');
  });
  it('NEW → pending', () => {
    expect(TbankProvider.mapStatus('NEW')).toBe('pending');
  });
  it('REVERSED / REFUNDED / PARTIAL_REFUNDED → refunded', () => {
    expect(TbankProvider.mapStatus('REVERSED')).toBe('refunded');
    expect(TbankProvider.mapStatus('REFUNDED')).toBe('refunded');
    expect(TbankProvider.mapStatus('PARTIAL_REFUNDED')).toBe('refunded');
  });
  it('REJECTED → failed', () => {
    expect(TbankProvider.mapStatus('REJECTED')).toBe('failed');
  });
  it('anything unknown → unknown', () => {
    expect(TbankProvider.mapStatus('SOMETHING_NEW')).toBe('unknown');
    expect(TbankProvider.mapStatus(undefined)).toBe('unknown');
  });
});
