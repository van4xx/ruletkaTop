import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';

import { REFERRAL_LIFETIME_CAP_COINS, type ReferralTier } from '@ruletka/shared-types';

import type { WalletService } from '../wallet/wallet.service';
import { ReferralsService } from './referrals.service';
import type { ReferralEdgeDocument } from './schemas/referral-edge.schema';
import type { ReferralLinkDocument } from './schemas/referral-link.schema';

/**
 * In-memory stand-ins for the four Mongo collections the service touches:
 *   - referrallinks   (`linkRows`)
 *   - referraledges   (`edgeRows`)
 *   - profiles        (`profileRows`)
 *   - cointransactions(`coinTxRows`)
 *
 * Each "model" exposes JUST the surface the service uses (`findOne`, `find`,
 * `findOneAndUpdate`, `updateOne`, `create`, `aggregate`) so the spec is hermetic
 * without standing up a real Mongoose connection.
 */

interface LinkRow {
  userId: Types.ObjectId;
  code: string;
  totalSignups: number;
  totalEarnedCoins: number;
}

interface EdgeRow {
  _id: Types.ObjectId;
  inviterId: Types.ObjectId;
  inviteeId: Types.ObjectId;
  tier: ReferralTier;
  hasMadeFirstPurchase: boolean;
  createdAt: Date;
}

interface ProfileRow {
  userId: Types.ObjectId;
  nickname: string;
  avatarUrl: string | null;
}

interface CoinTxRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  delta: number;
  type: string;
  refId: string | null;
  balanceAfter: number;
  createdAt: Date;
}

const id = (hex: string): Types.ObjectId =>
  new Types.ObjectId(hex.padEnd(24, '0').slice(0, 24));

/**
 * Tiny chainable mock of Mongoose's QueryBuilder. The service uses
 * `find().select().sort().limit().lean().exec()` / `findOne().lean().exec()` etc.;
 * every chainable returns `this`, and `.exec()` resolves with whatever the test
 * supplies via the factory.
 */
function chain<T>(value: T): {
  select: () => unknown;
  sort: () => unknown;
  limit: () => unknown;
  lean: () => unknown;
  exec: () => Promise<T>;
} {
  const q = {
    select() {
      return q;
    },
    sort() {
      return q;
    },
    limit() {
      return q;
    },
    lean() {
      return q;
    },
    exec() {
      return Promise.resolve(value);
    },
  };
  return q;
}

function makeLinkModel(rows: LinkRow[]) {
  return {
    findOne: jest.fn((filter: Record<string, unknown>) => {
      const found = rows.find((r) => filterMatches(r, filter)) ?? null;
      return chain(found);
    }),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn((filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const row = rows.find((r) => filterMatches(r, filter));
      if (row) {
        if (update.$inc) {
          for (const [key, value] of Object.entries(update.$inc as Record<string, number>)) {
            (row as unknown as Record<string, number>)[key] =
              ((row as unknown as Record<string, number>)[key] ?? 0) + value;
          }
        }
      } else if (update.$inc && (update as { upsert?: boolean }).upsert !== false) {
        // upsert: create a default row when the filter matches userId only.
        const userId = (filter as { userId: Types.ObjectId }).userId;
        if (userId) {
          const fresh: LinkRow = { userId, code: '', totalSignups: 0, totalEarnedCoins: 0 };
          for (const [key, value] of Object.entries(update.$inc as Record<string, number>)) {
            (fresh as unknown as Record<string, number>)[key] = value;
          }
          rows.push(fresh);
        }
      }
      return { exec: () => Promise.resolve({ modifiedCount: row ? 1 : 0 }) };
    }),
    create: jest.fn(async (doc: Partial<LinkRow>) => {
      // Reject on userId collision (unique index).
      if (rows.some((r) => r.userId.equals(doc.userId!))) {
        const err = new Error('E11000 duplicate key (userId)');
        (err as { code?: number }).code = 11000;
        throw err;
      }
      if (rows.some((r) => r.code === doc.code)) {
        const err = new Error('E11000 duplicate key (code)');
        (err as { code?: number }).code = 11000;
        throw err;
      }
      const row: LinkRow = {
        userId: doc.userId!,
        code: doc.code!,
        totalSignups: doc.totalSignups ?? 0,
        totalEarnedCoins: doc.totalEarnedCoins ?? 0,
      };
      rows.push(row);
      return row;
    }),
  };
}

function makeEdgeModel(rows: EdgeRow[]) {
  return {
    findOne: jest.fn((filter: Record<string, unknown>) => {
      const found = rows.find((r) => filterMatches(r, filter)) ?? null;
      return chain(found);
    }),
    find: jest.fn((filter: Record<string, unknown>) => {
      const matches = rows.filter((r) => filterMatches(r, filter));
      return chain(matches);
    }),
    updateOne: jest.fn((filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const row = rows.find((r) => filterMatches(r, filter));
      if (row && update.$set) {
        Object.assign(row, update.$set);
        return { exec: () => Promise.resolve({ modifiedCount: 1 }) };
      }
      return { exec: () => Promise.resolve({ modifiedCount: 0 }) };
    }),
    create: jest.fn(async (doc: Partial<EdgeRow>) => {
      // Unique partial index on (inviteeId) where tier=1 — collide rebinds.
      if (
        doc.tier === 1 &&
        rows.some((r) => r.tier === 1 && r.inviteeId.equals(doc.inviteeId!))
      ) {
        const err = new Error('E11000 duplicate key (inviteeId tier=1)');
        (err as { code?: number }).code = 11000;
        throw err;
      }
      const row: EdgeRow = {
        _id: new Types.ObjectId(),
        inviterId: doc.inviterId!,
        inviteeId: doc.inviteeId!,
        tier: doc.tier!,
        hasMadeFirstPurchase: doc.hasMadeFirstPurchase ?? false,
        createdAt: new Date(),
      };
      rows.push(row);
      return row;
    }),
    aggregate: jest.fn(() => ({
      exec: async () => {
        // Return per-tier counts for the inviter aggregation only.
        const buckets: Record<number, number> = {};
        return Object.entries(buckets).map(([tier, count]) => ({
          _id: Number(tier),
          count,
        }));
      },
    })),
  };
}

function makeProfileModel(rows: ProfileRow[]) {
  return {
    findOne: jest.fn((filter: Record<string, unknown>) => {
      const found = rows.find((r) => filterMatches(r, filter)) ?? null;
      return chain(found);
    }),
    find: jest.fn((filter: Record<string, unknown>) => {
      const matches = rows.filter((r) => filterMatches(r, filter));
      return chain(matches);
    }),
  };
}

function makeCoinTxModel(rows: CoinTxRow[]) {
  return {
    find: jest.fn((filter: Record<string, unknown>) => {
      const matches = rows.filter((r) => filterMatches(r, filter));
      return chain(matches);
    }),
    aggregate: jest.fn(() => ({ exec: () => Promise.resolve([]) })),
  };
}

/**
 * Mini Mongo filter matcher — supports equality on top-level fields, `$in`
 * for ObjectId lists, and a special-case `inviteeId` ObjectId comparison.
 * Enough to exercise the spec scenarios without re-implementing Mongo. Row
 * type is loose (`unknown`) so it accepts the four collection-row interfaces
 * without per-collection narrowing.
 */
function filterMatches(row: unknown, filter: Record<string, unknown>): boolean {
  const r = row as Record<string, unknown>;
  for (const [key, condition] of Object.entries(filter)) {
    const value = r[key];
    if (
      condition &&
      typeof condition === 'object' &&
      '$in' in (condition as Record<string, unknown>)
    ) {
      const list = (condition as { $in: Types.ObjectId[] }).$in;
      const ok = list.some((c) =>
        c instanceof Types.ObjectId && value instanceof Types.ObjectId
          ? c.equals(value)
          : c === value,
      );
      if (!ok) return false;
      continue;
    }
    if (condition instanceof Types.ObjectId && value instanceof Types.ObjectId) {
      if (!condition.equals(value)) return false;
      continue;
    }
    if (condition !== value) return false;
  }
  return true;
}

describe('ReferralsService', () => {
  const alice = id('a1');
  const bob = id('b2');
  const carol = id('c3');
  const dave = id('d4');

  let linkRows: LinkRow[];
  let edgeRows: EdgeRow[];
  let profileRows: ProfileRow[];
  let coinTxRows: CoinTxRow[];
  let wallet: { credit: jest.Mock };
  let service: ReferralsService;

  beforeEach(() => {
    linkRows = [];
    edgeRows = [];
    profileRows = [
      { userId: alice, nickname: 'Alice', avatarUrl: null },
      { userId: bob, nickname: 'Bob', avatarUrl: null },
      { userId: carol, nickname: 'Carol', avatarUrl: null },
      { userId: dave, nickname: 'Dave', avatarUrl: null },
    ];
    coinTxRows = [];
    wallet = {
      credit: jest.fn().mockResolvedValue(1),
    };
    service = new ReferralsService(
      makeLinkModel(linkRows) as unknown as Model<ReferralLinkDocument>,
      makeEdgeModel(edgeRows) as unknown as Model<ReferralEdgeDocument>,
      makeProfileModel(profileRows) as unknown as never,
      makeCoinTxModel(coinTxRows) as unknown as never,
      wallet as unknown as WalletService,
      'https://example.test',
    );
  });

  it('link generation is idempotent per user', async () => {
    const first = await service.ensureLink(alice.toString());
    const second = await service.ensureLink(alice.toString());
    expect(first.code).toEqual(second.code);
    expect(linkRows.length).toBe(1);
  });

  it('bind creates the T1 edge for the inviter', async () => {
    await service.ensureLink(alice.toString());
    const code = linkRows[0]!.code;
    await service.bind(bob.toString(), code);
    expect(edgeRows.find((e) => e.tier === 1 && e.inviteeId.equals(bob))?.inviterId.equals(alice)).toBe(
      true,
    );
  });

  it('bind walks the chain to set T2 and T3 edges correctly', async () => {
    // Alice → Bob (T1), then Bob → Carol (T1 for Carol; Alice becomes T2)
    // then Carol → Dave (T1 for Dave; Bob T2; Alice T3).
    await service.ensureLink(alice.toString());
    const aliceCode = linkRows[0]!.code;
    await service.bind(bob.toString(), aliceCode);

    await service.ensureLink(bob.toString());
    const bobCode = linkRows.find((l) => l.userId.equals(bob))!.code;
    await service.bind(carol.toString(), bobCode);

    await service.ensureLink(carol.toString());
    const carolCode = linkRows.find((l) => l.userId.equals(carol))!.code;
    await service.bind(dave.toString(), carolCode);

    const daveEdges = edgeRows.filter((e) => e.inviteeId.equals(dave));
    expect(daveEdges.find((e) => e.tier === 1)?.inviterId.equals(carol)).toBe(true);
    expect(daveEdges.find((e) => e.tier === 2)?.inviterId.equals(bob)).toBe(true);
    expect(daveEdges.find((e) => e.tier === 3)?.inviterId.equals(alice)).toBe(true);
  });

  it('rejects a re-bind attempt with 409', async () => {
    await service.ensureLink(alice.toString());
    const code = linkRows[0]!.code;
    await service.bind(bob.toString(), code);
    await expect(service.bind(bob.toString(), code)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a self-referral with 400', async () => {
    await service.ensureLink(alice.toString());
    const code = linkRows[0]!.code;
    await expect(service.bind(alice.toString(), code)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('credits rewards on purchase with idempotent refIds (anti-bot: T1 gated, T2/T3 immediate)', async () => {
    // Set up chain Alice → Bob → Carol → Dave; Dave makes a purchase.
    await service.ensureLink(alice.toString());
    await service.bind(bob.toString(), linkRows[0]!.code);
    await service.ensureLink(bob.toString());
    await service.bind(
      carol.toString(),
      linkRows.find((l) => l.userId.equals(bob))!.code,
    );
    await service.ensureLink(carol.toString());
    await service.bind(
      dave.toString(),
      linkRows.find((l) => l.userId.equals(carol))!.code,
    );

    const purchaseLedger = id('ee1');
    // First purchase: 1000 coins. T1=Carol (gated, NO credit on first purchase),
    // T2=Bob (3% = 30 coins), T3=Alice (1% = 10 coins).
    const result = await service.creditPurchaseRewards(dave.toString(), 1000, purchaseLedger.toString());
    expect(result.credited).toHaveLength(2);
    const bobCredit = result.credited.find((c) => c.tier === 2);
    const aliceCredit = result.credited.find((c) => c.tier === 3);
    expect(bobCredit).toBeDefined();
    expect(bobCredit?.coins).toBe(30);
    expect(aliceCredit?.coins).toBe(10);

    expect(wallet.credit).toHaveBeenCalledTimes(2);
    // The refIds are namespaced per tier+purchaser+ledger so a redelivered sweep
    // hits the wallet's (type, refId) idempotency.
    expect(wallet.credit).toHaveBeenCalledWith(
      bob.toString(),
      30,
      'referral',
      `referral-reward:T2:${dave.toString()}:${purchaseLedger.toString()}`,
    );
    expect(wallet.credit).toHaveBeenCalledWith(
      alice.toString(),
      10,
      'referral',
      `referral-reward:T3:${dave.toString()}:${purchaseLedger.toString()}`,
    );

    // The T1 anti-bot gate flipped, so the SECOND purchase credits Carol (10%).
    wallet.credit.mockClear();
    const ledger2 = id('ee2');
    const second = await service.creditPurchaseRewards(dave.toString(), 1000, ledger2.toString());
    expect(second.credited).toHaveLength(3);
    expect(second.credited.find((c) => c.tier === 1)?.coins).toBe(100);
    expect(second.credited.find((c) => c.tier === 2)?.coins).toBe(30);
    expect(second.credited.find((c) => c.tier === 3)?.coins).toBe(10);
  });

  it('stops crediting once the inviter hits the lifetime cap', async () => {
    // Set up direct T1: Alice → Bob.
    await service.ensureLink(alice.toString());
    await service.bind(bob.toString(), linkRows[0]!.code);
    // Pre-pump Alice's counter close to the cap so the next reward partially fills.
    linkRows[0]!.totalEarnedCoins = REFERRAL_LIFETIME_CAP_COINS - 5;
    // Flip the gate so T1 credits land (the spec for the first-purchase rule is
    // covered separately above; here we only care about the cap).
    edgeRows.forEach((e) => {
      if (e.tier === 1 && e.inviteeId.equals(bob)) {
        e.hasMadeFirstPurchase = true;
      }
    });

    // 1000 coin purchase → 10% = 100 coin T1 reward; should be capped at 5.
    const ledger = id('fe1');
    await service.creditPurchaseRewards(bob.toString(), 1000, ledger.toString());
    expect(wallet.credit).toHaveBeenCalledWith(
      alice.toString(),
      5,
      'referral',
      `referral-reward:T1:${bob.toString()}:${ledger.toString()}`,
    );
    expect(linkRows[0]!.totalEarnedCoins).toBe(REFERRAL_LIFETIME_CAP_COINS);

    // Next purchase: cap hit, nothing credited.
    wallet.credit.mockClear();
    const ledger2 = id('fe2');
    const result = await service.creditPurchaseRewards(bob.toString(), 1000, ledger2.toString());
    expect(result.credited).toHaveLength(0);
    expect(wallet.credit).not.toHaveBeenCalled();
  });
});
