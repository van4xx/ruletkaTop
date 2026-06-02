import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Model } from 'mongoose';

import type { Connection } from 'mongoose';

import type { SendGiftDto } from '@ruletka/shared-types';

import type { BlocksService } from '../moderation/blocks.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PremiumService } from '../premium/premium.service';
import type { WalletService } from '../wallet/wallet.service';
import { GiftsService } from './gifts.service';
import type { GiftDocument } from './schemas/gift.schema';
import type { GiftTransactionDocument } from './schemas/gift-transaction.schema';

/**
 * Builds a chainable Mongoose query stub whose terminal `.exec()` resolves to
 * `result` (mirrors the house style in wallet.service.spec.ts).
 */
function queryReturning(result: unknown): { exec: jest.Mock } {
  return { exec: jest.fn().mockResolvedValue(result) };
}

/**
 * A stand-in hydrated gift document. `_id` is an object exposing `toString()`
 * (as a real ObjectId would) so the service can use it as the giftTx `giftId`.
 */
function giftDoc(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    _id: { toString: () => 'gift-id-1' },
    code: 'rose',
    title: 'Rose',
    animationUrl: '/gifts/rose.json',
    priceCoins: 10,
    rarity: 'common',
    isPremiumOnly: false,
    ...overrides,
  };
}

describe('GiftsService.sendGift', () => {
  const fromUserId = '507f1f77bcf86cd799439011';
  const toUserId = '507f1f77bcf86cd799439022';

  let service: GiftsService;
  let giftModel: { findById: jest.Mock };
  let giftTxModel: { create: jest.Mock };
  let wallet: { debit: jest.Mock; credit: jest.Mock };
  let premium: { isPremium: jest.Mock };
  let blocks: { isBlocked: jest.Mock };
  let notifications: { create: jest.Mock };
  // Stubs the `users` collection read used by the recipient existence/ban check.
  let usersFindOne: jest.Mock;
  let connection: { collection: jest.Mock };

  const baseDto: SendGiftDto = {
    giftId: '507f1f77bcf86cd799439033',
    toUserId,
    context: 'chat',
    message: 'enjoy!',
  };

  beforeEach(() => {
    giftModel = { findById: jest.fn() };
    giftTxModel = {
      // create() resolves an array (Mongoose's array-insert overload).
      create: jest.fn().mockResolvedValue([
        {
          _id: { toString: () => 'gifttx-1' },
          fromUserId: { toString: () => fromUserId },
          toUserId: { toString: () => toUserId },
          giftId: { toString: () => 'gift-id-1' },
          priceCoins: 10,
          context: 'chat',
          get: (key: string) => (key === 'createdAt' ? new Date('2026-01-01T00:00:00.000Z') : undefined),
        },
      ]),
    };
    wallet = {
      debit: jest.fn().mockResolvedValue(90),
      credit: jest.fn().mockResolvedValue(100),
    };
    premium = { isPremium: jest.fn().mockResolvedValue(false) };
    blocks = { isBlocked: jest.fn().mockResolvedValue(false) };
    // Notification fan-out is a best-effort side-effect; stub it to a no-op.
    notifications = { create: jest.fn().mockResolvedValue(null) };
    // Default: recipient exists and is not banned.
    usersFindOne = jest.fn().mockResolvedValue({ _id: toUserId, isBanned: false });
    connection = { collection: jest.fn().mockReturnValue({ findOne: usersFindOne }) };

    service = new GiftsService(
      giftModel as unknown as Model<GiftDocument>,
      giftTxModel as unknown as Model<GiftTransactionDocument>,
      connection as unknown as Connection,
      wallet as unknown as WalletService,
      premium as unknown as PremiumService,
      blocks as unknown as BlocksService,
      notifications as unknown as NotificationsService,
    );
  });

  it('debits the sender (gift_out, referencing the gift-tx id) and records a gift transaction', async () => {
    giftModel.findById.mockReturnValue(queryReturning(giftDoc({ priceCoins: 10 })));

    const result = await service.sendGift(fromUserId, baseDto);

    // The sender is charged the gift price as a `gift_out` debit.
    expect(wallet.debit).toHaveBeenCalledTimes(1);
    const [debUser, debCoins, debType, debRef] = wallet.debit.mock.calls[0] as [
      string,
      number,
      string,
      string,
    ];
    expect(debUser).toBe(fromUserId);
    expect(debCoins).toBe(10);
    expect(debType).toBe('gift_out');
    expect(typeof debRef).toBe('string');
    expect(debRef.length).toBeGreaterThan(0);

    // The gift-transaction is persisted with that SAME id used as the ledger refId,
    // tying the wallet ledger row to the gift record (traceability).
    expect(giftTxModel.create).toHaveBeenCalledTimes(1);
    const [docs] = giftTxModel.create.mock.calls[0] as [Array<Record<string, unknown>>];
    const row = docs[0]!;
    expect(row.priceCoins).toBe(10);
    expect(row.context).toBe('chat');
    expect(row.message).toBe('enjoy!');
    expect((row._id as { toString: () => string }).toString()).toBe(debRef);

    // No refund on the happy path.
    expect(wallet.credit).not.toHaveBeenCalled();

    // Returns the contract shape.
    expect(result).toMatchObject({
      id: 'gifttx-1',
      fromUserId,
      toUserId,
      priceCoins: 10,
      context: 'chat',
    });
  });

  it('charges BEFORE recording the gift (debit precedes the gift-tx write)', async () => {
    const order: string[] = [];
    giftModel.findById.mockReturnValue(queryReturning(giftDoc()));
    wallet.debit.mockImplementation(async () => {
      order.push('debit');
      return 90;
    });
    giftTxModel.create.mockImplementation(async () => {
      order.push('create');
      return [
        {
          _id: { toString: () => 'gifttx-1' },
          fromUserId: { toString: () => fromUserId },
          toUserId: { toString: () => toUserId },
          giftId: { toString: () => 'gift-id-1' },
          priceCoins: 10,
          context: 'chat',
          get: () => new Date('2026-01-01T00:00:00.000Z'),
        },
      ];
    });

    await service.sendGift(fromUserId, baseDto);

    expect(order).toEqual(['debit', 'create']);
  });

  it('rejects a premium-only gift for a NON-premium sender (403) without charging', async () => {
    giftModel.findById.mockReturnValue(queryReturning(giftDoc({ isPremiumOnly: true, priceCoins: 2000 })));
    premium.isPremium.mockResolvedValue(false);

    await expect(service.sendGift(fromUserId, baseDto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(premium.isPremium).toHaveBeenCalledWith(fromUserId);
    // Critically: gating happens before any money moves or any record is written.
    expect(wallet.debit).not.toHaveBeenCalled();
    expect(giftTxModel.create).not.toHaveBeenCalled();
  });

  it('allows a premium-only gift for a PREMIUM sender (charges + records)', async () => {
    giftModel.findById.mockReturnValue(queryReturning(giftDoc({ isPremiumOnly: true, priceCoins: 2000 })));
    premium.isPremium.mockResolvedValue(true);
    giftTxModel.create.mockResolvedValue([
      {
        _id: { toString: () => 'gifttx-2' },
        fromUserId: { toString: () => fromUserId },
        toUserId: { toString: () => toUserId },
        giftId: { toString: () => 'gift-id-1' },
        priceCoins: 2000,
        context: 'chat',
        get: () => new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const result = await service.sendGift(fromUserId, baseDto);

    expect(premium.isPremium).toHaveBeenCalledWith(fromUserId);
    expect(wallet.debit).toHaveBeenCalledWith(
      fromUserId,
      2000,
      'gift_out',
      expect.any(String),
    );
    expect(result.priceCoins).toBe(2000);
  });

  it('does not consult premium for a non-premium gift', async () => {
    giftModel.findById.mockReturnValue(queryReturning(giftDoc({ isPremiumOnly: false })));

    await service.sendGift(fromUserId, baseDto);

    expect(premium.isPremium).not.toHaveBeenCalled();
  });

  it('rejects self-gifting (400) before any lookup', async () => {
    await expect(
      service.sendGift(fromUserId, { ...baseDto, toUserId: fromUserId }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(giftModel.findById).not.toHaveBeenCalled();
    expect(wallet.debit).not.toHaveBeenCalled();
  });

  it('rejects a gift to a NON-EXISTENT recipient (404) without charging', async () => {
    usersFindOne.mockResolvedValue(null);

    await expect(service.sendGift(fromUserId, baseDto)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    // The catalogue is never even consulted, and no money moves.
    expect(giftModel.findById).not.toHaveBeenCalled();
    expect(wallet.debit).not.toHaveBeenCalled();
  });

  it('rejects a gift to a BANNED recipient (403) without charging', async () => {
    usersFindOne.mockResolvedValue({ _id: toUserId, isBanned: true });

    await expect(service.sendGift(fromUserId, baseDto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(wallet.debit).not.toHaveBeenCalled();
    expect(giftTxModel.create).not.toHaveBeenCalled();
  });

  it('rejects a gift when a block exists between the two users (403), in either direction', async () => {
    blocks.isBlocked.mockResolvedValue(true);

    await expect(service.sendGift(fromUserId, baseDto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    // isBlocked is consulted with the sender→recipient pair; the service treats
    // a block as bidirectional (BlocksService.isBlocked already checks both).
    expect(blocks.isBlocked).toHaveBeenCalledWith(fromUserId, toUserId);
    expect(wallet.debit).not.toHaveBeenCalled();
  });

  it('rejects a malformed (non-ObjectId) recipient id (404) before charging', async () => {
    await expect(
      service.sendGift(fromUserId, { ...baseDto, toUserId: 'not-an-id' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(wallet.debit).not.toHaveBeenCalled();
  });

  it('validates the recipient (exists/ban/block) BEFORE the premium gate', async () => {
    // A banned recipient must short-circuit before we even look at premium-only.
    usersFindOne.mockResolvedValue({ _id: toUserId, isBanned: true });
    giftModel.findById.mockReturnValue(queryReturning(giftDoc({ isPremiumOnly: true })));

    await expect(service.sendGift(fromUserId, baseDto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(premium.isPremium).not.toHaveBeenCalled();
  });

  it('throws 404 for an unknown gift and never charges', async () => {
    giftModel.findById.mockReturnValue(queryReturning(null));

    await expect(service.sendGift(fromUserId, baseDto)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(wallet.debit).not.toHaveBeenCalled();
    expect(giftTxModel.create).not.toHaveBeenCalled();
  });

  it('does NOT swallow an insufficient-funds debit error (no gift recorded)', async () => {
    giftModel.findById.mockReturnValue(queryReturning(giftDoc({ priceCoins: 500 })));
    const debitErr = new Error('insufficient');
    wallet.debit.mockRejectedValue(debitErr);

    await expect(service.sendGift(fromUserId, baseDto)).rejects.toBe(debitErr);

    // Charge failed up front ⇒ no gift row, and nothing to refund.
    expect(giftTxModel.create).not.toHaveBeenCalled();
    expect(wallet.credit).not.toHaveBeenCalled();
  });

  it('compensates with a refund credit if the gift-tx write fails after a successful debit', async () => {
    giftModel.findById.mockReturnValue(queryReturning(giftDoc({ priceCoins: 25 })));
    const writeErr = new Error('mongo write failed');
    giftTxModel.create.mockRejectedValue(writeErr);

    await expect(service.sendGift(fromUserId, baseDto)).rejects.toBe(writeErr);

    // The earlier debit is reversed with a `refund` credit for the same amount,
    // keyed by the same gift-tx id used for the original debit (so we never
    // charge without recording the gift).
    expect(wallet.credit).toHaveBeenCalledTimes(1);
    const [refUser, refCoins, refType, refRef] = wallet.credit.mock.calls[0] as [
      string,
      number,
      string,
      string,
    ];
    const [, , , debRef] = wallet.debit.mock.calls[0] as [string, number, string, string];
    expect(refUser).toBe(fromUserId);
    expect(refCoins).toBe(25);
    expect(refType).toBe('refund');
    expect(refRef).toBe(debRef);
  });

  it('still surfaces the original write error even if the compensating refund also fails', async () => {
    giftModel.findById.mockReturnValue(queryReturning(giftDoc({ priceCoins: 25 })));
    const writeErr = new Error('mongo write failed');
    giftTxModel.create.mockRejectedValue(writeErr);
    wallet.credit.mockRejectedValue(new Error('refund failed too'));

    // The refund failure is logged, not thrown; the caller sees the real cause.
    await expect(service.sendGift(fromUserId, baseDto)).rejects.toBe(writeErr);
    expect(wallet.credit).toHaveBeenCalledTimes(1);
  });
});
