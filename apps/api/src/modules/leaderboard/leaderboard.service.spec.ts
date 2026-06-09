import { Types } from 'mongoose';

import type { Connection } from 'mongoose';
import type { Redis } from 'ioredis';

import { LeaderboardService } from './leaderboard.service';

const USER_A = '507f1f77bcf86cd7994390a1';
const USER_B = '507f1f77bcf86cd7994390a2';
const CALLER = '507f1f77bcf86cd7994390c0';

/** A `{ toArray }` cursor stub resolving to `rows`. */
function cursor(rows: unknown[]): { toArray: jest.Mock } {
  return { toArray: jest.fn().mockResolvedValue(rows) };
}

/**
 * A minimal in-memory Redis double covering exactly what {@link LeaderboardService}
 * uses for its shared-result cache: `get(key)` and `set(key, value, 'EX', ttl)`.
 * Backed by a plain Map so a test can drive cache hits/misses, and the `get`/`set`
 * jest.fns are exposed for call-count assertions.
 *
 * Pass `failing: true` to make every op reject — exercising the best-effort
 * "degrade to a direct compute" path.
 */
function makeRedis(opts: { failing?: boolean } = {}): {
  redis: Redis;
  store: Map<string, string>;
  get: jest.Mock;
  set: jest.Mock;
} {
  const store = new Map<string, string>();
  const get = jest.fn((key: string) => {
    if (opts.failing) {
      return Promise.reject(new Error('redis down'));
    }
    return Promise.resolve(store.get(key) ?? null);
  });
  const set = jest.fn((key: string, value: string) => {
    if (opts.failing) {
      return Promise.reject(new Error('redis down'));
    }
    store.set(key, value);
    return Promise.resolve('OK');
  });
  return { redis: { get, set } as unknown as Redis, store, get, set };
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
  /** The `users` source-of-truth $in for the tombstone/ban guard. */
  users?: Partial<{ find: jest.Mock }>;
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

    const { redis } = makeRedis();
    const service = new LeaderboardService(connection, redis);
    const res = await service.getLeaderboard({ metric: 'gifts', limit: 50 }, USER_A);

    expect(res.metric).toBe('gifts');
    expect(res.entries).toEqual([
      { rank: 1, userId: USER_A, nickname: 'A', avatarUrl: null, isPremium: true, score: 500 },
      { rank: 2, userId: USER_B, nickname: 'B', avatarUrl: 'u', isPremium: false, score: 120 },
    ]);
    expect(res.me).toBeNull();

    // The aggregation groups received gifts by recipient and caps with $limit.
    const pipeline = (giftsAggregate.mock.calls[0]! as unknown[])[0] as Array<
      Record<string, unknown>
    >;
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
      cursor([
        { userId: new Types.ObjectId(USER_A), nickname: 'A', avatarUrl: null, isPremium: false },
      ]),
    );
    const { connection } = connectionWith({
      gifttransactions: { aggregate: giftsAggregate },
      profiles: { find: profilesFind },
    });

    const { redis } = makeRedis();
    const service = new LeaderboardService(connection, redis);
    const res = await service.getLeaderboard({ metric: 'gifts', limit: 50 }, USER_A);

    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]!.userId).toBe(USER_A);
  });

  it('excludes a tombstoned (deletedAt) user from the board and closes the rank gap', async () => {
    // USER_A out-scores USER_B, but USER_A is torn down → dropped; USER_B takes
    // rank 1 (no gap left by the excluded leader).
    const giftsAggregate = jest.fn(() =>
      cursor([
        { _id: new Types.ObjectId(USER_A), score: 900 },
        { _id: new Types.ObjectId(USER_B), score: 100 },
      ]),
    );
    const profilesFind = jest.fn(() =>
      cursor([
        { userId: new Types.ObjectId(USER_A), nickname: 'A', avatarUrl: null, isPremium: false },
        { userId: new Types.ObjectId(USER_B), nickname: 'B', avatarUrl: null, isPremium: false },
      ]),
    );
    // The `users` guard reports USER_A as dead (deletedAt set).
    const usersFind = jest.fn(() => cursor([{ _id: new Types.ObjectId(USER_A) }]));
    const { connection, collection } = connectionWith({
      gifttransactions: { aggregate: giftsAggregate },
      profiles: { find: profilesFind },
      users: { find: usersFind },
    });

    const { redis } = makeRedis();
    const service = new LeaderboardService(connection, redis);
    const res = await service.getLeaderboard({ metric: 'gifts', limit: 50 }, CALLER);

    // USER_A is gone; USER_B is the sole entry and is re-ranked to 1.
    expect(res.entries).toEqual([
      { rank: 1, userId: USER_B, nickname: 'B', avatarUrl: null, isPremium: false, score: 100 },
    ]);
    // The guard consulted the `users` source-of-truth.
    expect(collection).toHaveBeenCalledWith('users');
  });

  it("computes the caller's own rank as `me` when they fall outside the slice", async () => {
    // Board slice does NOT include the caller.
    const giftsAggregate = jest
      .fn()
      // 1st call: the top slice (computeTopScores).
      .mockReturnValueOnce(cursor([{ _id: new Types.ObjectId(USER_A), score: 1000 }]))
      // 2nd call: caller's own score sum (scoreForUser).
      .mockReturnValueOnce(cursor([{ score: 250 }]))
      // 3rd call: the SHARED grouped score list (computeAheadGrouping). Four
      // users out-score the caller's 250 → ahead = 4 (counted in-memory).
      .mockReturnValueOnce(
        cursor([{ score: 1000 }, { score: 700 }, { score: 400 }, { score: 300 }, { score: 200 }]),
      );
    const profilesFind = jest
      .fn()
      // join for the slice…
      .mockReturnValueOnce(
        cursor([
          { userId: new Types.ObjectId(USER_A), nickname: 'A', avatarUrl: null, isPremium: false },
        ]),
      )
      // …then the caller's own profile for `me`.
      .mockReturnValueOnce(
        cursor([
          { userId: new Types.ObjectId(CALLER), nickname: 'Me', avatarUrl: null, isPremium: true },
        ]),
      );
    const { connection } = connectionWith({
      gifttransactions: { aggregate: giftsAggregate },
      profiles: { find: profilesFind },
    });

    const { redis } = makeRedis();
    const service = new LeaderboardService(connection, redis);
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
    const aggregate = jest.fn(() => cursor([{ _id: new Types.ObjectId(USER_A), score: 900 }]));
    const profilesFind = jest
      .fn()
      .mockReturnValueOnce(
        cursor([
          { userId: new Types.ObjectId(USER_A), nickname: 'A', avatarUrl: null, isPremium: false },
        ]),
      )
      .mockReturnValueOnce(
        cursor([
          { userId: new Types.ObjectId(CALLER), nickname: 'Me', avatarUrl: null, isPremium: false },
        ]),
      );
    const { connection, collection } = connectionWith({
      wallets: { aggregate, countDocuments: walletsCount, findOne: walletsFindOne } as never,
      profiles: { find: profilesFind },
    });

    const { redis } = makeRedis();
    const service = new LeaderboardService(connection, redis);
    const res = await service.getLeaderboard({ metric: 'coins', limit: 10 }, CALLER);

    expect(res.metric).toBe('coins');
    expect(res.entries[0]).toMatchObject({ rank: 1, userId: USER_A, score: 900 });
    // `me` rank = (#wallets with balance > caller's 80) + 1 = 3.
    expect(res.me).toMatchObject({ rank: 3, score: 80 });
    expect(collection).toHaveBeenCalledWith('wallets');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `top` metric clamps each placement's span to its ELAPSED portion so future,
// not-yet-earned days are never counted — on the board, the `me` score, and the
// shared ahead-grouping alike (so all three agree).
// ─────────────────────────────────────────────────────────────────────────────
describe('LeaderboardService — top metric clamps to the elapsed span', () => {
  /** Pull every `$sum` placement-span expression out of an aggregate pipeline. */
  function sumExprsIn(aggregate: jest.Mock): unknown[] {
    return aggregate.mock.calls.flatMap((call) => {
      const pipeline = call[0] as Array<Record<string, unknown>>;
      const out: unknown[] = [];
      for (const stage of pipeline) {
        const group = stage.$group as { score?: { $sum?: unknown } } | undefined;
        if (group?.score?.$sum) {
          out.push(group.score.$sum);
        }
      }
      return out;
    });
  }

  it('clamps min(expiresAt, now) and floors at 0 on the board, me-score, and ahead grouping', async () => {
    const topAggregate = jest
      .fn()
      // board slice (computeTopScores)…
      .mockReturnValueOnce(cursor([{ _id: new Types.ObjectId(USER_A), score: 3 }]))
      // caller's own top score (scoreForUser)…
      .mockReturnValueOnce(cursor([{ score: 1 }]))
      // shared ahead grouping (computeAheadGrouping).
      .mockReturnValueOnce(cursor([{ score: 5 }, { score: 2 }]));
    const profilesFind = jest
      .fn()
      .mockReturnValueOnce(
        cursor([
          { userId: new Types.ObjectId(USER_A), nickname: 'A', avatarUrl: null, isPremium: false },
        ]),
      )
      .mockReturnValueOnce(
        cursor([
          { userId: new Types.ObjectId(CALLER), nickname: 'Me', avatarUrl: null, isPremium: false },
        ]),
      );
    const { connection } = connectionWith({
      topplacements: { aggregate: topAggregate },
      profiles: { find: profilesFind },
    });

    const { redis } = makeRedis();
    const service = new LeaderboardService(connection, redis);
    const res = await service.getLeaderboard({ metric: 'top', limit: 50 }, CALLER);

    // Caller's score 1 → 2 users (5, 2) out-score → ahead 2 → rank 3.
    expect(res.me).toMatchObject({ rank: 3, score: 1 });

    // Every span expression clamps the END to min(expiresAt, now) and FLOORS the
    // elapsed span at 0 — no raw `expiresAt - startsAt` survives anywhere.
    const exprs = sumExprsIn(topAggregate);
    expect(exprs.length).toBeGreaterThanOrEqual(3);
    for (const expr of exprs) {
      const json = JSON.stringify(expr);
      expect(json).toContain('$min');
      expect(json).toContain('$max');
      expect(json).toContain('$expiresAt');
      // The raw, unclamped subtraction must NOT appear.
      expect(json).not.toContain('"$subtract":["$expiresAt","$startsAt"]');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared-result caching: the expensive full-collection $group is served from
// Redis with a short TTL, recomputed on miss, and concurrent misses on a node
// are collapsed to a SINGLE scan (single-flight). The per-caller `me` stays
// outside the cache.
// ─────────────────────────────────────────────────────────────────────────────
describe('LeaderboardService — shared-result cache', () => {
  it('serves the board slice from cache on the SECOND request (one scan per window)', async () => {
    const giftsAggregate = jest.fn(() =>
      cursor([{ _id: new Types.ObjectId(USER_A), score: 500 }]),
    );
    const profilesFind = jest.fn(() =>
      cursor([
        { userId: new Types.ObjectId(USER_A), nickname: 'A', avatarUrl: null, isPremium: false },
      ]),
    );
    const { connection } = connectionWith({
      gifttransactions: { aggregate: giftsAggregate },
      profiles: { find: profilesFind },
    });

    // Shared Redis across both requests so the second reads the first's write.
    const { redis, set } = makeRedis();
    const service = new LeaderboardService(connection, redis);

    // Caller is the ranked user both times → no `me` scan to muddy the count.
    await service.getLeaderboard({ metric: 'gifts', limit: 50 }, USER_A);
    await service.getLeaderboard({ metric: 'gifts', limit: 50 }, USER_A);

    // The board slice aggregation ran exactly ONCE; the 2nd request was a hit.
    expect(giftsAggregate).toHaveBeenCalledTimes(1);
    // The result was written to the cache under a (metric, limit) key with a TTL.
    expect(set).toHaveBeenCalledWith(
      'leaderboard:top:gifts:50',
      expect.any(String),
      'EX',
      expect.any(Number),
    );
  });

  it('collapses CONCURRENT misses on a node to a single scan (single-flight)', async () => {
    // A slow aggregate so both requests are in-flight at the same time.
    let resolveScan!: (rows: unknown[]) => void;
    const scan = new Promise<unknown[]>((r) => {
      resolveScan = r;
    });
    const giftsAggregate = jest.fn(() => ({
      toArray: jest.fn(() => scan),
    }));
    const profilesFind = jest.fn(() =>
      cursor([
        { userId: new Types.ObjectId(USER_A), nickname: 'A', avatarUrl: null, isPremium: false },
      ]),
    );
    const { connection } = connectionWith({
      gifttransactions: { aggregate: giftsAggregate },
      profiles: { find: profilesFind },
    });

    const { redis } = makeRedis();
    const service = new LeaderboardService(connection, redis);

    // Fire two concurrent requests BEFORE the scan resolves.
    const p1 = service.getLeaderboard({ metric: 'gifts', limit: 50 }, USER_A);
    const p2 = service.getLeaderboard({ metric: 'gifts', limit: 50 }, USER_A);
    // Let both reach the cache-miss compute and register single-flight.
    await Promise.resolve();
    resolveScan([{ _id: new Types.ObjectId(USER_A), score: 500 }]);
    const [r1, r2] = await Promise.all([p1, p2]);

    // Both requests resolved from the ONE scan rather than each issuing its own.
    expect(giftsAggregate).toHaveBeenCalledTimes(1);
    expect(r1.entries[0]!.userId).toBe(USER_A);
    expect(r2.entries[0]!.userId).toBe(USER_A);
  });

  it('degrades to a direct compute when Redis is unavailable (best-effort)', async () => {
    const giftsAggregate = jest.fn(() =>
      cursor([{ _id: new Types.ObjectId(USER_A), score: 500 }]),
    );
    const profilesFind = jest.fn(() =>
      cursor([
        { userId: new Types.ObjectId(USER_A), nickname: 'A', avatarUrl: null, isPremium: false },
      ]),
    );
    const { connection } = connectionWith({
      gifttransactions: { aggregate: giftsAggregate },
      profiles: { find: profilesFind },
    });

    // Every Redis op rejects → the service must still serve the board directly.
    const { redis } = makeRedis({ failing: true });
    const service = new LeaderboardService(connection, redis);
    // Silence the best-effort cache-failure debug lines.
    (service as unknown as { logger: { debug: jest.Mock } }).logger = {
      debug: jest.fn(),
    } as never;

    const res = await service.getLeaderboard({ metric: 'gifts', limit: 50 }, USER_A);

    expect(res.entries[0]!.userId).toBe(USER_A);
    expect(giftsAggregate).toHaveBeenCalled();
  });
});
