import { Types } from 'mongoose';

import type { Connection } from 'mongoose';

import { AdminEconomyService } from './admin-economy.service';

const USER_A = '507f1f77bcf86cd7994390a1';
const TX_ID = '507f1f77bcf86cd7994390f1';
const TX_AT = new Date('2024-03-04T05:06:07.000Z');

/** A `{ toArray }` cursor stub resolving to `rows`. */
function cursor(rows: unknown[]): { toArray: jest.Mock } {
  return { toArray: jest.fn().mockResolvedValue(rows) };
}

/**
 * Per-collection handler map. Each collection exposes the surface the service
 * uses: `countDocuments`, `aggregate` (for the Σ pipelines), and a `find` chain
 * (`.find().sort().limit().toArray()`) for the recent-tx feed.
 */
interface Handlers {
  users?: { countDocuments?: jest.Mock };
  profiles?: { countDocuments?: jest.Mock };
  wallets?: { aggregate?: jest.Mock };
  gifttransactions?: { aggregate?: jest.Mock };
  topplacements?: { countDocuments?: jest.Mock };
  cointransactions?: { find?: jest.Mock };
}

function connectionWith(h: Handlers): { connection: Connection; collection: jest.Mock } {
  const collection = jest.fn((name: keyof Handlers) => {
    const c = (h[name] ?? {}) as {
      countDocuments?: jest.Mock;
      aggregate?: jest.Mock;
      find?: jest.Mock;
    };
    return {
      countDocuments: c.countDocuments ?? jest.fn().mockResolvedValue(0),
      aggregate: c.aggregate ?? jest.fn(() => cursor([])),
      find: c.find ?? jest.fn(() => findChain([])),
    };
  });
  return { connection: { collection } as unknown as Connection, collection };
}

/** `.find().sort().limit().toArray()` chain stub resolving to `rows`. */
function findChain(rows: unknown[]): { sort: jest.Mock } {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(rows),
  };
  return chain;
}

describe('AdminEconomyService.getOverview', () => {
  it('returns the full overview shape with counts, sums, and mapped recent tx', async () => {
    // Distinct counts so we can assert each lands in the right field. The
    // service issues countDocuments in this order PER collection:
    //   users: total, banned, verified, new24h, new7d  → distinguish by filter.
    const usersCount = jest.fn((filter: Record<string, unknown>) => {
      if (filter.isBanned === true) return Promise.resolve(3);
      if (filter.emailVerified === true) return Promise.resolve(7);
      if (filter.createdAt) {
        // 24h window has the tighter (later) lower bound than the 7d window.
        const gte = (filter.createdAt as { $gte: Date }).$gte.getTime();
        const now = Date.now();
        const ageMs = now - gte;
        return Promise.resolve(ageMs < 2 * 24 * 60 * 60 * 1000 ? 2 : 9);
      }
      return Promise.resolve(42); // total
    });

    const { connection, collection } = connectionWith({
      users: { countDocuments: usersCount },
      profiles: { countDocuments: jest.fn().mockResolvedValue(5) },
      topplacements: { countDocuments: jest.fn().mockResolvedValue(4) },
      wallets: { aggregate: jest.fn(() => cursor([{ _id: null, total: 12345 }])) },
      gifttransactions: { aggregate: jest.fn(() => cursor([{ _id: null, total: 6789 }])) },
      cointransactions: {
        find: jest.fn(() =>
          findChain([
            {
              _id: new Types.ObjectId(TX_ID),
              userId: new Types.ObjectId(USER_A),
              type: 'gift_out',
              delta: -50,
              createdAt: TX_AT,
            },
          ]),
        ),
      },
    });

    const service = new AdminEconomyService(connection);
    const res = await service.getOverview();

    expect(res).toEqual({
      totalUsers: 42,
      premiumUsers: 5,
      bannedUsers: 3,
      verifiedUsers: 7,
      coinsInCirculation: 12345,
      giftsValueCoins: 6789,
      activeTopPlacements: 4,
      newUsers24h: 2,
      newUsers7d: 9,
      recentTransactions: [
        {
          id: TX_ID,
          userId: USER_A,
          kind: 'gift_out',
          amountCoins: -50,
          createdAt: TX_AT.toISOString(),
        },
      ],
    });

    // Premium is counted off the denormalised profiles.isPremium flag.
    expect(collection).toHaveBeenCalledWith('profiles');

    // Active-placement window is `startsAt <= now < expiresAt`.
    const placementFilter = (
      (connection.collection('topplacements').countDocuments as jest.Mock).mock
        .calls[0]! as unknown[]
    )[0] as Record<string, { $lte?: Date; $gt?: Date }>;
    expect(placementFilter.startsAt?.$lte).toBeInstanceOf(Date);
    expect(placementFilter.expiresAt?.$gt).toBeInstanceOf(Date);
  });

  it('defaults sums to 0 and recent tx to [] when collections are empty', async () => {
    const { connection } = connectionWith({});
    const service = new AdminEconomyService(connection);
    const res = await service.getOverview();

    expect(res.coinsInCirculation).toBe(0);
    expect(res.giftsValueCoins).toBe(0);
    expect(res.totalUsers).toBe(0);
    expect(res.recentTransactions).toEqual([]);
  });
});
