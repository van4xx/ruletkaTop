import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

import type { Connection } from 'mongoose';

import type { AuditService } from '../admin/audit.service';
import { AdminEconomyService } from './admin-economy.service';

const USER_A = '507f1f77bcf86cd7994390a1';
const TX_ID = '507f1f77bcf86cd7994390f1';
const TX_AT = new Date('2024-03-04T05:06:07.000Z');
const ADMIN = '507f1f77bcf86cd7994390c0';

/** A no-op {@link AuditService} stub whose `log` is a resolved jest mock. */
function auditStub(): AuditService & { log: jest.Mock } {
  return { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService & {
    log: jest.Mock;
  };
}

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

    const service = new AdminEconomyService(connection, auditStub());
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
    const service = new AdminEconomyService(connection, auditStub());
    const res = await service.getOverview();

    expect(res.coinsInCirculation).toBe(0);
    expect(res.giftsValueCoins).toBe(0);
    expect(res.totalUsers).toBe(0);
    expect(res.recentTransactions).toEqual([]);
  });
});

// ── Catalogue mutations: audit trail ─────────────────────────────────────────
//
// Each mutating route threads the acting admin's id into the service, which logs
// a best-effort audit row AFTER the write succeeds. These build a focused
// `connection` whose target collection exposes exactly the surface each method
// touches (findOne / insertOne / findOneAndUpdate / deleteOne).
const CP_ID = '507f1f77bcf86cd7994390b1';

/** A single-collection `connection` stub: `connection.collection(name)` → `impl`. */
function singleCollection(name: string, impl: Record<string, jest.Mock>): Connection {
  const collection = jest.fn((requested: string) => {
    if (requested === name) return impl;
    // Any other collection (e.g. the `profiles` join) resolves empty.
    return { find: jest.fn(() => cursor([])), findOne: jest.fn().mockResolvedValue(null) };
  });
  return { collection } as unknown as Connection;
}

describe('AdminEconomyService — coin-package CRUD audit trail', () => {
  it('createCoinPackage writes the row THEN records `economy.coin_package.create`', async () => {
    const insertedId = new Types.ObjectId(CP_ID);
    const coinpackages = {
      findOne: jest.fn().mockResolvedValue(null), // no dup code
      insertOne: jest.fn().mockResolvedValue({ insertedId }),
    };
    const audit = auditStub();
    const service = new AdminEconomyService(singleCollection('coinpackages', coinpackages), audit);

    const row = await service.createCoinPackage(
      { code: 'starter', coins: 100, priceRub: 99, bonusCoins: 10 },
      ADMIN,
    );

    expect(coinpackages.insertOne).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith({
      actorId: ADMIN,
      action: 'economy.coin_package.create',
      targetType: 'coin_package',
      targetId: row.id,
      meta: { code: 'starter', coins: 100, priceRub: 99, bonusCoins: 10 },
    });
  });

  it('createCoinPackage does NOT audit on a duplicate-code conflict', async () => {
    const coinpackages = {
      findOne: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(CP_ID), code: 'starter' }),
      insertOne: jest.fn(),
    };
    const audit = auditStub();
    const service = new AdminEconomyService(singleCollection('coinpackages', coinpackages), audit);

    await expect(
      service.createCoinPackage({ code: 'starter', coins: 100, priceRub: 99 }, ADMIN),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('deleteCoinPackage records `economy.coin_package.delete` after a successful delete', async () => {
    const coinpackages = { deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }) };
    const audit = auditStub();
    const service = new AdminEconomyService(singleCollection('coinpackages', coinpackages), audit);

    await service.deleteCoinPackage(CP_ID, ADMIN);

    expect(audit.log).toHaveBeenCalledWith({
      actorId: ADMIN,
      action: 'economy.coin_package.delete',
      targetType: 'coin_package',
      targetId: CP_ID,
    });
  });

  it('deleteCoinPackage 404s an absent row WITHOUT auditing', async () => {
    const coinpackages = { deleteOne: jest.fn().mockResolvedValue({ deletedCount: 0 }) };
    const audit = auditStub();
    const service = new AdminEconomyService(singleCollection('coinpackages', coinpackages), audit);

    await expect(service.deleteCoinPackage(CP_ID, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('AdminEconomyService — removeTopPlacement audit trail', () => {
  const PLACEMENT_ID = '507f1f77bcf86cd7994390d1';
  const OWNER_ID = '507f1f77bcf86cd7994390d2';

  it('captures {userId, coinsSpent} via a findOne BEFORE the delete, then audits', async () => {
    const findOne = jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(PLACEMENT_ID),
      userId: new Types.ObjectId(OWNER_ID),
      coinsSpent: 500,
    });
    const deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
    const topplacements = { findOne, deleteOne };
    const audit = auditStub();
    const service = new AdminEconomyService(
      singleCollection('topplacements', topplacements),
      audit,
    );

    await service.removeTopPlacement(PLACEMENT_ID, ADMIN);

    // The read happens before the delete so the trail records whose paid spot went.
    const findOrder = findOne.mock.invocationCallOrder[0]!;
    const deleteOrder = deleteOne.mock.invocationCallOrder[0]!;
    expect(findOrder).toBeLessThan(deleteOrder);

    expect(audit.log).toHaveBeenCalledWith({
      actorId: ADMIN,
      action: 'economy.top.remove',
      targetType: 'top_placement',
      targetId: PLACEMENT_ID,
      meta: { userId: OWNER_ID, coinsSpent: 500 },
    });
  });

  it('404s an absent placement WITHOUT auditing', async () => {
    const topplacements = {
      findOne: jest.fn().mockResolvedValue(null),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    };
    const audit = auditStub();
    const service = new AdminEconomyService(
      singleCollection('topplacements', topplacements),
      audit,
    );

    await expect(service.removeTopPlacement(PLACEMENT_ID, ADMIN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(audit.log).not.toHaveBeenCalled();
  });
});
