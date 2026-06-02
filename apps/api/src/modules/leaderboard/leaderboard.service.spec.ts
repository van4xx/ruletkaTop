import { Types } from 'mongoose';

import type { Connection } from 'mongoose';

import { LeaderboardService } from './leaderboard.service';

const USER_A = '507f1f77bcf86cd7994390a1';
const USER_B = '507f1f77bcf86cd7994390a2';
const CALLER = '507f1f77bcf86cd7994390c0';

/** A `{ toArray }` cursor stub resolving to `rows`. */
function cursor(rows: unknown[]): { toArray: jest.Mock } {
  return { toArray: jest.fn().mockResolvedValue(rows) };
}

/**
 * Build a `connection` whose `collection(name)` dispatches to a per-collection
 * handler map. Each handler returns the chainable Mongo collection surface the
 * service uses (`aggregate`, `find`, `findOne`, `countDocuments`).
 */
function connectionWith(handlers: {
  gifttransactions?: Partial<{
    aggregate: jest.Mock;
  }>;
  profiles?: Partial<{ find: jest.Mock; findOne: jest.Mock }>;
  wallets?: Partial<{ findOne: jest.Mock; countDocuments: jest.Mock }>;
  topplacements?: Partial<{ aggregate: jest.Mock }>;
}): { connection: Connection; collection: jest.Mock } {
  const collection = jest.fn((name: string) => {
    const h = (handlers as Record<string, Record<string, jest.Mock>>)[name] ?? {};
    return {
      aggregate: h.aggregate ?? jest.fn(() => cursor([])),
      find: h.find ?? jest.fn(() => cursor([])),
      findOne: h.findOne ?? jest.fn().mockResolvedValue(null),
      countDocuments: h.countDocuments ?? jest.fn().mockResolvedValue(0),
    };
  });
  return { connection: { collection } as unknown as Connection, collection };
}

describe('LeaderboardService.getLeaderboard', () => {
  it('ranks the gifts metric desc, joins profiles, and 1-indexes ranks', async () => {
    const giftsAggregate = jest.fn(() =>
      cursor([
        { _id: new Types.ObjectId(USER_A), score: 500 },
        { _id: new Types.ObjectId(USER_B), score: 120 },
      ]),
    );
    const profilesFind = jest.fn(() =>
      cursor([
        { userId: new Types.ObjectId(USER_A), nickname: 'A', avatarUrl: null, isPremium: true },
        { userId: new Types.ObjectId(USER_B), nickname: 'B', avatarUrl: 'u', isPremium: false },
      ]),
    );
    // Caller is one of the ranked users → `me` resolves to null (no repeat).
    const { connection } = connectionWith({
      gifttransactions: { aggregate: giftsAggregate },
      profiles: { find: profilesFind },
    });

    const service = new LeaderboardService(connection);
    const res = await service.getLeaderboard({ metric: 'gifts', limit: 50 }, USER_A);

    expect(res.metric).toBe('gifts');
    expect(res.entries).toEqual([
      { rank: 1, userId: USER_A, nickname: 'A', avatarUrl: null, isPremium: true, score: 500 },
      { rank: 2, userId: USER_B, nickname: 'B', avatarUrl: 'u', isPremium: false, score: 120 },
    ]);
    expect(res.me).toBeNull();

    // The aggregation groups received gifts by recipient and caps with $limit.
    const pipeline = (giftsAggregate.mock.calls[0]! as unknown[])[0] as Array<Record<string, unknown>>;
    expect(pipeline).toEqual(
      expect.arrayContaining([
        { $group: { _id: '$toUserId', score: { $sum: '$priceCoins' } } },
        { $sort: { score: -1 } },
        { $limit: 50 },
      ]),
    );
  });

  it('skips ranked users whose profile no longer resolves (no rank gap crash)', async () => {
    const giftsAggregate = jest.fn(() =>
      cursor([
        { _id: new Types.ObjectId(USER_A), score: 300 },
        { _id: new Types.ObjectId(USER_B), score: 100 },
      ]),
    );
    // Only USER_A has a profile; USER_B is dropped from the entries.
    const profilesFind = jest.fn(() =>
      cursor([{ userId: new Types.ObjectId(USER_A), nickname: 'A', avatarUrl: null, isPremium: false }]),
    );
    const { connection } = connectionWith({
      gifttransactions: { aggregate: giftsAggregate },
      profiles: { find: profilesFind },
    });

    const service = new LeaderboardService(connection);
    const res = await service.getLeaderboard({ metric: 'gifts', limit: 50 }, USER_A);

    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]!.userId).toBe(USER_A);
  });

  it("computes the caller's own rank as `me` when they fall outside the slice", async () => {
    // Board slice does NOT include the caller.
    const giftsAggregate = jest
      .fn()
      // 1st call: the top slice.
      .mockReturnValueOnce(cursor([{ _id: new Types.ObjectId(USER_A), score: 1000 }]))
      // 2nd call: caller's own score sum.
      .mockReturnValueOnce(cursor([{ score: 250 }]))
      // 3rd call: count of users ahead of the caller (strictly higher score).
      .mockReturnValueOnce(cursor([{ count: 4 }]));
    const profilesFind = jest
      .fn()
      // join for the slice…
      .mockReturnValueOnce(
        cursor([{ userId: new Types.ObjectId(USER_A), nickname: 'A', avatarUrl: null, isPremium: false }]),
      )
      // …then the caller's own profile for `me`.
      .mockReturnValueOnce(
        cursor([{ userId: new Types.ObjectId(CALLER), nickname: 'Me', avatarUrl: null, isPremium: true }]),
      );
    const { connection } = connectionWith({
      gifttransactions: { aggregate: giftsAggregate },
      profiles: { find: profilesFind },
    });

    const service = new LeaderboardService(connection);
    const res = await service.getLeaderboard({ metric: 'gifts', limit: 50 }, CALLER);

    expect(res.entries).toHaveLength(1);
    expect(res.me).toEqual({
      // 4 users ahead → rank 5.
      rank: 5,
      userId: CALLER,
      nickname: 'Me',
      avatarUrl: null,
      isPremium: true,
      score: 250,
    });
  });

  it('coins metric reads wallet balances desc and counts ahead via balance gt', async () => {
    const walletsCount = jest.fn().mockResolvedValue(2);
    const walletsFindOne = jest.fn().mockResolvedValue({ balanceCoins: 80 });
    const aggregate = jest.fn(() =>
      cursor([{ _id: new Types.ObjectId(USER_A), score: 900 }]),
    );
    const profilesFind = jest
      .fn()
      .mockReturnValueOnce(
        cursor([{ userId: new Types.ObjectId(USER_A), nickname: 'A', avatarUrl: null, isPremium: false }]),
      )
      .mockReturnValueOnce(
        cursor([{ userId: new Types.ObjectId(CALLER), nickname: 'Me', avatarUrl: null, isPremium: false }]),
      );
    const { connection, collection } = connectionWith({
      wallets: { aggregate, countDocuments: walletsCount, findOne: walletsFindOne } as never,
      profiles: { find: profilesFind },
    });

    const service = new LeaderboardService(connection);
    const res = await service.getLeaderboard({ metric: 'coins', limit: 10 }, CALLER);

    expect(res.metric).toBe('coins');
    expect(res.entries[0]).toMatchObject({ rank: 1, userId: USER_A, score: 900 });
    // `me` rank = (#wallets with balance > caller's 80) + 1 = 3.
    expect(res.me).toMatchObject({ rank: 3, score: 80 });
    expect(collection).toHaveBeenCalledWith('wallets');
  });
});
