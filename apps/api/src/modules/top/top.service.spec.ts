import { BadRequestException } from '@nestjs/common';
import type { Model } from 'mongoose';

import type { TopPurchaseDto } from '@ruletka/shared-types';

import type { WalletService } from '../wallet/wallet.service';
import type { TopPlacementDocument } from './schemas/top-placement.schema';
import { MIN_TOP_PLACEMENT_COINS, TopService } from './top.service';

/** A chainable `find().sort().exec()` stub resolving to `docs`. */
function findSortReturning(docs: unknown[]): {
  sort: jest.Mock;
  exec: jest.Mock;
} {
  return {
    sort: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(docs),
  };
}

/** Build a stand-in hydrated placement document with ISO-capable date fields. */
function placementDoc(over: Partial<Record<string, unknown>> = {}): unknown {
  const startsAt = new Date('2026-01-01T00:00:00.000Z');
  const expiresAt = new Date('2026-01-02T00:00:00.000Z');
  return {
    _id: { toString: () => 'placement-1' },
    userId: { toString: () => '507f1f77bcf86cd799439011' },
    lane: 'left',
    priority: 100,
    coinsSpent: 100,
    startsAt,
    expiresAt,
    ...over,
  };
}

describe('TopService.purchase', () => {
  const userId = '507f1f77bcf86cd799439011';

  let service: TopService;
  let placementModel: { create: jest.Mock; find: jest.Mock };
  let wallet: { debit: jest.Mock; credit: jest.Mock };

  const dto: TopPurchaseDto = { lane: 'left', durationHours: 24, coins: 100 };

  beforeEach(() => {
    placementModel = {
      create: jest.fn().mockResolvedValue([placementDoc()]),
      find: jest.fn(),
    };
    wallet = {
      debit: jest.fn().mockResolvedValue(0),
      credit: jest.fn().mockResolvedValue(100),
    };

    service = new TopService(
      placementModel as unknown as Model<TopPlacementDocument>,
      wallet as unknown as WalletService,
    );
  });

  it('debits coins (type "top") then creates a placement with a future expiry', async () => {
    const before = Date.now();
    const result = await service.purchase(userId, dto);
    const after = Date.now();

    // Step 1: the buyer is charged via a `top` debit referencing the placement id.
    expect(wallet.debit).toHaveBeenCalledTimes(1);
    const [debUser, debCoins, debType, debRef] = wallet.debit.mock.calls[0] as [
      string,
      number,
      string,
      string,
    ];
    expect(debUser).toBe(userId);
    expect(debCoins).toBe(100);
    expect(debType).toBe('top');
    expect(typeof debRef).toBe('string');

    // Step 2: the placement is created; spend drives priority, and the same id
    // is the ledger refId.
    expect(placementModel.create).toHaveBeenCalledTimes(1);
    const [docs] = placementModel.create.mock.calls[0] as [Array<Record<string, unknown>>];
    const row = docs[0]!;
    expect(row.lane).toBe('left');
    expect(row.priority).toBe(100);
    expect(row.coinsSpent).toBe(100);
    expect((row._id as { toString: () => string }).toString()).toBe(debRef);

    // expiresAt is durationHours into the future relative to startsAt.
    const startsAt = row.startsAt as Date;
    const expiresAt = row.expiresAt as Date;
    expect(startsAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(startsAt.getTime()).toBeLessThanOrEqual(after);
    expect(expiresAt.getTime() - startsAt.getTime()).toBe(24 * 60 * 60 * 1000);
    // And, concretely, the placement expires in the future.
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    expect(result).toMatchObject({ lane: 'left', priority: 100, coinsSpent: 100 });
    expect(wallet.credit).not.toHaveBeenCalled();
  });

  it('charges BEFORE creating the placement', async () => {
    const order: string[] = [];
    wallet.debit.mockImplementation(async () => {
      order.push('debit');
      return 0;
    });
    placementModel.create.mockImplementation(async () => {
      order.push('create');
      return [placementDoc()];
    });

    await service.purchase(userId, dto);

    expect(order).toEqual(['debit', 'create']);
  });

  it('derives priority from coins spent (bigger spenders rank higher)', async () => {
    placementModel.create.mockResolvedValue([placementDoc({ priority: 5000, coinsSpent: 5000 })]);

    await service.purchase(userId, { lane: 'right', durationHours: 1, coins: 5000 });

    const [docs] = placementModel.create.mock.calls[0] as [Array<Record<string, unknown>>];
    const row = docs[0]!;
    expect(row.priority).toBe(5000);
    expect(row.coinsSpent).toBe(5000);
    expect(row.lane).toBe('right');
  });

  it('honours durationHours when computing expiry (1h vs 720h)', async () => {
    // coins kept at/above the placement floor; this case exercises duration only.
    await service.purchase(userId, { lane: 'left', durationHours: 1, coins: 50 });
    const [shortDocs] = placementModel.create.mock.calls[0] as [Array<Record<string, unknown>>];
    const shortRow = shortDocs[0]!;
    expect(
      (shortRow.expiresAt as Date).getTime() - (shortRow.startsAt as Date).getTime(),
    ).toBe(60 * 60 * 1000);

    placementModel.create.mockClear();
    await service.purchase(userId, { lane: 'left', durationHours: 720, coins: 50 });
    const [longDocs] = placementModel.create.mock.calls[0] as [Array<Record<string, unknown>>];
    const longRow = longDocs[0]!;
    expect(
      (longRow.expiresAt as Date).getTime() - (longRow.startsAt as Date).getTime(),
    ).toBe(720 * 60 * 60 * 1000);
  });

  it(`rejects a placement below the ${MIN_TOP_PLACEMENT_COINS}-coin floor (400) without charging`, async () => {
    await expect(
      service.purchase(userId, { lane: 'left', durationHours: 24, coins: MIN_TOP_PLACEMENT_COINS - 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // The floor is enforced before any money moves or any row is written.
    expect(wallet.debit).not.toHaveBeenCalled();
    expect(placementModel.create).not.toHaveBeenCalled();
  });

  it(`allows a placement exactly at the ${MIN_TOP_PLACEMENT_COINS}-coin floor`, async () => {
    placementModel.create.mockResolvedValue([
      placementDoc({ priority: MIN_TOP_PLACEMENT_COINS, coinsSpent: MIN_TOP_PLACEMENT_COINS }),
    ]);

    await service.purchase(userId, {
      lane: 'left',
      durationHours: 24,
      coins: MIN_TOP_PLACEMENT_COINS,
    });

    expect(wallet.debit).toHaveBeenCalledTimes(1);
    const [, debCoins] = wallet.debit.mock.calls[0] as [string, number, string, string];
    expect(debCoins).toBe(MIN_TOP_PLACEMENT_COINS);
  });

  it('propagates an insufficient-funds debit error and creates no placement', async () => {
    const err = new Error('insufficient');
    wallet.debit.mockRejectedValue(err);

    await expect(service.purchase(userId, dto)).rejects.toBe(err);

    expect(placementModel.create).not.toHaveBeenCalled();
    expect(wallet.credit).not.toHaveBeenCalled();
  });

  it('refunds the debit if the placement write fails after charging', async () => {
    const writeErr = new Error('mongo down');
    placementModel.create.mockRejectedValue(writeErr);

    await expect(service.purchase(userId, dto)).rejects.toBe(writeErr);

    expect(wallet.credit).toHaveBeenCalledTimes(1);
    const [refUser, refCoins, refType, refRef] = wallet.credit.mock.calls[0] as [
      string,
      number,
      string,
      string,
    ];
    const [, , , debRef] = wallet.debit.mock.calls[0] as [string, number, string, string];
    expect(refUser).toBe(userId);
    expect(refCoins).toBe(100);
    expect(refType).toBe('refund');
    expect(refRef).toBe(debRef);
  });
});

describe('TopService.getActiveFeed', () => {
  let service: TopService;
  let placementModel: { create: jest.Mock; find: jest.Mock };
  let wallet: { debit: jest.Mock; credit: jest.Mock };

  beforeEach(() => {
    placementModel = { create: jest.fn(), find: jest.fn() };
    wallet = { debit: jest.fn(), credit: jest.fn() };
    service = new TopService(
      placementModel as unknown as Model<TopPlacementDocument>,
      wallet as unknown as WalletService,
    );
  });

  it('groups active placements into the two lanes, querying each lane with the active window', async () => {
    const leftDocs = [
      placementDoc({ _id: { toString: () => 'L1' }, lane: 'left', priority: 200, coinsSpent: 200 }),
      placementDoc({ _id: { toString: () => 'L2' }, lane: 'left', priority: 50, coinsSpent: 50 }),
    ];
    const rightDocs = [
      placementDoc({ _id: { toString: () => 'R1' }, lane: 'right', priority: 10, coinsSpent: 10 }),
    ];

    // First find() call is the 'left' lane, second is 'right' (Promise.all order).
    placementModel.find
      .mockReturnValueOnce(findSortReturning(leftDocs))
      .mockReturnValueOnce(findSortReturning(rightDocs));

    const feed = await service.getActiveFeed();

    expect(feed.left.map((p) => p.id)).toEqual(['L1', 'L2']);
    expect(feed.right.map((p) => p.id)).toEqual(['R1']);

    // Both lanes were queried.
    expect(placementModel.find).toHaveBeenCalledTimes(2);

    // Each query filters by lane + the active window (startsAt <= now < expiresAt).
    const laneFilters = placementModel.find.mock.calls.map(
      (c) => c[0] as Record<string, any>,
    );
    const lanes = laneFilters.map((f) => f.lane).sort();
    expect(lanes).toEqual(['left', 'right']);
    for (const filter of laneFilters) {
      expect(filter.startsAt).toHaveProperty('$lte');
      expect(filter.expiresAt).toHaveProperty('$gt');
      // The window is anchored to "now": startsAt cutoff and expiry cutoff agree.
      expect((filter.startsAt.$lte as Date).getTime()).toBe(
        (filter.expiresAt.$gt as Date).getTime(),
      );
    }
  });

  it('orders each lane by priority descending, then newest first', async () => {
    const leftQuery = findSortReturning([placementDoc()]);
    placementModel.find
      .mockReturnValueOnce(leftQuery)
      .mockReturnValueOnce(findSortReturning([]));

    await service.getActiveFeed();

    // The lane query sorts by priority desc with createdAt desc as the tiebreak.
    expect(leftQuery.sort).toHaveBeenCalledWith({ priority: -1, createdAt: -1 });
  });

  it('returns empty lanes when nothing is active', async () => {
    placementModel.find
      .mockReturnValueOnce(findSortReturning([]))
      .mockReturnValueOnce(findSortReturning([]));

    const feed = await service.getActiveFeed();

    expect(feed).toEqual({ left: [], right: [] });
  });
});
