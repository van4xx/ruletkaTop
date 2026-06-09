import { BadRequestException } from '@nestjs/common';
import type { Connection, Model } from 'mongoose';

import type { TopPurchaseDto } from '@ruletka/shared-types';

import type { WalletService } from '../wallet/wallet.service';
import type { TopPlacementDocument } from './schemas/top-placement.schema';
import { durationHoursForCoins, MIN_TOP_PLACEMENT_COINS, TopService } from './top.service';

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

/**
 * Mongoose `Connection` stub for the feed reads. `collection('profiles')` joins
 * `profileRows` (the batched `$in`); `collection('users')` returns `deadUserRows`
 * — the tombstone/ban guard's source-of-truth `$in` (each row a `{ _id }` of a
 * torn-down / banned owner). Both default to no rows (all owners live; entries
 * with no profile are dropped).
 */
function connectionReturning(profileRows: unknown[] = [], deadUserRows: unknown[] = []): Connection {
  return {
    collection: jest.fn((name: string) => ({
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue(name === 'users' ? deadUserRows : profileRows),
      }),
    })),
  } as unknown as Connection;
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

describe('durationHoursForCoins — spend-derived window (tier table)', () => {
  it('caps the floor spend at the SHORTEST window (50 coins ≠ 720h)', () => {
    const hours = durationHoursForCoins(MIN_TOP_PLACEMENT_COINS);
    expect(hours).toBe(24);
    expect(hours).not.toBe(720);
  });

  it('escalates the window as spend climbs the tiers', () => {
    expect(durationHoursForCoins(50)).toBe(24); // floor tier
    expect(durationHoursForCoins(200)).toBe(72); // 3 days
    expect(durationHoursForCoins(500)).toBe(168); // 7 days
    expect(durationHoursForCoins(1000)).toBe(720); // 30-day ceiling, top spend only
  });

  it('returns the lower tier just below a threshold', () => {
    expect(durationHoursForCoins(199)).toBe(24);
    expect(durationHoursForCoins(499)).toBe(72);
    expect(durationHoursForCoins(999)).toBe(168);
  });

  it('only the top tier (>=1000 coins) ever unlocks the 720h ceiling', () => {
    expect(durationHoursForCoins(999)).not.toBe(720);
    expect(durationHoursForCoins(1000)).toBe(720);
    expect(durationHoursForCoins(100_000)).toBe(720);
  });
});

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
      connectionReturning(),
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

    // expiresAt is the SPEND-DERIVED window into the future relative to startsAt.
    // 100 coins falls in the floor tier (>=50, <200) → 24h, NOT the client-sent
    // durationHours (which is no longer authoritative).
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

  it('DERIVES the window from spend, ignoring a client-supplied durationHours', async () => {
    // The 50-coin floor sends durationHours: 720 (the DTO ceiling) but only the
    // top tier (>=1000 coins) buys 720h — so the floor must yield the SHORT 24h
    // window, never the 30-day window the client asked for. This is the verified
    // bypass: spend now gates the lifetime server-side.
    await service.purchase(userId, {
      lane: 'left',
      durationHours: 720,
      coins: MIN_TOP_PLACEMENT_COINS,
    });
    const [floorDocs] = placementModel.create.mock.calls[0] as [Array<Record<string, unknown>>];
    const floorRow = floorDocs[0]!;
    const floorWindowMs =
      (floorRow.expiresAt as Date).getTime() - (floorRow.startsAt as Date).getTime();
    // 24h, NOT the 720h the client requested.
    expect(floorWindowMs).toBe(24 * 60 * 60 * 1000);
    expect(floorWindowMs).not.toBe(720 * 60 * 60 * 1000);

    // A valid top-tier spend DOES unlock the full 720h window — even though it
    // sends a SHORT durationHours: the derived window is bought, not declared.
    placementModel.create.mockClear();
    await service.purchase(userId, { lane: 'left', durationHours: 1, coins: 1000 });
    const [topDocs] = placementModel.create.mock.calls[0] as [Array<Record<string, unknown>>];
    const topRow = topDocs[0]!;
    expect((topRow.expiresAt as Date).getTime() - (topRow.startsAt as Date).getTime()).toBe(
      720 * 60 * 60 * 1000,
    );
  });

  it(`rejects a placement below the ${MIN_TOP_PLACEMENT_COINS}-coin floor (400) without charging`, async () => {
    await expect(
      service.purchase(userId, {
        lane: 'left',
        durationHours: 24,
        coins: MIN_TOP_PLACEMENT_COINS - 1,
      }),
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

  /** Rebuild the service with a profiles-join connection (+ optional dead owners). */
  function buildService(profileRows: unknown[] = [], deadUserRows: unknown[] = []): void {
    service = new TopService(
      placementModel as unknown as Model<TopPlacementDocument>,
      connectionReturning(profileRows, deadUserRows),
      wallet as unknown as WalletService,
    );
  }

  beforeEach(() => {
    placementModel = { create: jest.fn(), find: jest.fn() };
    wallet = { debit: jest.fn(), credit: jest.fn() };
    buildService();
  });

  it('groups active placements into the two lanes, querying each lane with the active window', async () => {
    const uid = '507f1f77bcf86cd799439011'; // the default placementDoc owner
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

    // Owner is LIVE and has a profile → all cards survive the read-time guards.
    buildService([
      { userId: { toString: () => uid }, nickname: 'mira', avatarUrl: null, isPremium: false },
    ]);

    const feed = await service.getActiveFeed();

    expect(feed.left.map((p) => p.id)).toEqual(['L1', 'L2']);
    expect(feed.right.map((p) => p.id)).toEqual(['R1']);

    // Both lanes were queried.
    expect(placementModel.find).toHaveBeenCalledTimes(2);

    // Each query filters by lane + the active window (startsAt <= now < expiresAt).
    const laneFilters = placementModel.find.mock.calls.map((c) => c[0] as Record<string, any>);
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
    placementModel.find.mockReturnValueOnce(leftQuery).mockReturnValueOnce(findSortReturning([]));

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

  it('enriches every entry with the promoted profile in one batched join', async () => {
    const uid = '507f1f77bcf86cd799439011';
    // Same promoted user in both lanes — the batch must de-dupe to one row.
    const leftDocs = [placementDoc({ _id: { toString: () => 'L1' }, lane: 'left' })];
    const rightDocs = [placementDoc({ _id: { toString: () => 'R1' }, lane: 'right' })];
    placementModel.find
      .mockReturnValueOnce(findSortReturning(leftDocs))
      .mockReturnValueOnce(findSortReturning(rightDocs));

    // Rebuild with a connection whose profiles join returns the promoted user.
    buildService([
      { userId: { toString: () => uid }, nickname: 'mira', avatarUrl: null, isPremium: true },
    ]);

    const feed = await service.getActiveFeed();

    expect(feed.left[0]?.profile).toEqual({
      id: uid,
      nickname: 'mira',
      avatarUrl: null,
      isPremium: true,
    });
    expect(feed.right[0]?.profile).toMatchObject({ id: uid, nickname: 'mira' });
  });

  it('drops the card when the promoted user has no resolvable profile', async () => {
    placementModel.find
      .mockReturnValueOnce(findSortReturning([placementDoc({ _id: { toString: () => 'L1' } })]))
      .mockReturnValueOnce(findSortReturning([]));
    // Default connection returns no profile rows → the card is dropped entirely
    // (defence-in-depth: a scrubbed/erased owner's placement never shows).

    const feed = await service.getActiveFeed();

    expect(feed.left).toEqual([]);
  });

  it("drops a banned (or tombstoned) owner's placement even when their profile still resolves", async () => {
    const liveUid = '507f1f77bcf86cd799439011';
    const bannedUid = '507f1f77bcf86cd799439022';
    placementModel.find
      .mockReturnValueOnce(
        findSortReturning([
          placementDoc({ _id: { toString: () => 'L1' }, userId: { toString: () => liveUid } }),
          placementDoc({ _id: { toString: () => 'L2' }, userId: { toString: () => bannedUid } }),
        ]),
      )
      .mockReturnValueOnce(findSortReturning([]));

    // Both owners still have a profile row…
    buildService(
      [
        { userId: { toString: () => liveUid }, nickname: 'live', avatarUrl: null, isPremium: false },
        {
          userId: { toString: () => bannedUid },
          nickname: 'banned',
          avatarUrl: null,
          isPremium: false,
        },
      ],
      // …but the `users` source-of-truth marks bannedUid as banned → dropped.
      [{ _id: { toString: () => bannedUid } }],
    );

    const feed = await service.getActiveFeed();

    // Only the live owner's card survives; the banned owner's is suppressed.
    expect(feed.left.map((p) => p.id)).toEqual(['L1']);
    expect(feed.left[0]?.userId).toBe(liveUid);
  });
});

describe('TopService.sweepExpired', () => {
  let service: TopService;
  let placementModel: { create: jest.Mock; find: jest.Mock; updateMany: jest.Mock };
  let wallet: { debit: jest.Mock; credit: jest.Mock };

  /** `updateMany(...).exec()` chain resolving to a Mongo write result. */
  function updateManyReturning(modifiedCount: number): { exec: jest.Mock } {
    return { exec: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount }) };
  }

  beforeEach(() => {
    placementModel = {
      create: jest.fn(),
      find: jest.fn(),
      updateMany: jest.fn().mockReturnValue(updateManyReturning(0)),
    };
    wallet = { debit: jest.fn(), credit: jest.fn() };
    service = new TopService(
      placementModel as unknown as Model<TopPlacementDocument>,
      connectionReturning(),
      wallet as unknown as WalletService,
    );
  });

  it('latches expired:true on past-window rows not yet reconciled', async () => {
    placementModel.updateMany.mockReturnValue(updateManyReturning(4));
    const now = new Date('2026-06-08T12:00:00.000Z');

    const count = await service.sweepExpired(now);

    expect(count).toBe(4);
    const [filter, update] = placementModel.updateMany.mock.calls[0] as [
      Record<string, any>,
      Record<string, any>,
    ];
    // Only matches rows past their window that have NOT already been latched.
    expect(filter.expired).toEqual({ $ne: true });
    expect((filter.expiresAt.$lte as Date).getTime()).toBe(now.getTime());
    expect(update.$set).toEqual({ expired: true });
  });

  it('returns 0 (no-op) when nothing is past its window', async () => {
    placementModel.updateMany.mockReturnValue(updateManyReturning(0));

    const count = await service.sweepExpired(new Date());

    expect(count).toBe(0);
  });

  it('treats a missing modifiedCount as 0 reconciled', async () => {
    placementModel.updateMany.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

    await expect(service.sweepExpired(new Date())).resolves.toBe(0);
  });
});
