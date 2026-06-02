import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

import type { AdminTransaction, EconomyOverview } from '@ruletka/shared-types';

/**
 * A raw aggregation pipeline as the NATIVE MongoDB driver consumes it (plain
 * stage objects via `connection.collection(name).aggregate`), mirroring
 * {@link LeaderboardService}.
 */
type AggregationPipeline = Record<string, unknown>[];

const DAY_MS = 24 * 60 * 60 * 1000;
/** How many recent ledger rows the overview surfaces. */
const RECENT_TX_LIMIT = 10;

/** A `cointransactions` row as read for the recent-activity feed. */
interface CoinTxRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: string;
  delta: number;
  createdAt: Date;
}

/**
 * Read-only economy + population snapshot for the admin dashboard, built ON READ
 * from existing collections with a handful of cheap aggregations — no new
 * tracking. Collections are read by NAME via the shared {@link Connection} (same
 * approach {@link LeaderboardService} uses), so this service depends on no
 * economy/users module.
 *
 * Sources:
 *  - population counts → `users` (`totalUsers`, `bannedUsers`, `verifiedUsers`,
 *    `newUsers24h`/`7d`) and `profiles` (`premiumUsers`, the denormalised
 *    `isPremium` flag that login/leaderboard also read);
 *  - `coinsInCirculation` → Σ `wallets.balanceCoins`;
 *  - `giftsValueCoins` → Σ `gifttransactions.priceCoins`;
 *  - `activeTopPlacements` → `topplacements` with `now ∈ [startsAt, expiresAt)`;
 *  - `recentTransactions` → newest ~10 `cointransactions` rows.
 */
@Injectable()
export class AdminEconomyService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** Build the full {@link EconomyOverview}. */
  async getOverview(): Promise<EconomyOverview> {
    const now = new Date();
    const since24h = new Date(now.getTime() - DAY_MS);
    const since7d = new Date(now.getTime() - 7 * DAY_MS);

    const users = this.connection.collection('users');
    const profiles = this.connection.collection('profiles');
    const wallets = this.connection.collection('wallets');
    const gifts = this.connection.collection('gifttransactions');
    const placements = this.connection.collection('topplacements');
    const coinTx = this.connection.collection('cointransactions');

    const [
      totalUsers,
      premiumUsers,
      bannedUsers,
      verifiedUsers,
      newUsers24h,
      newUsers7d,
      activeTopPlacements,
      coinsInCirculation,
      giftsValueCoins,
      recentTransactions,
    ] = await Promise.all([
      users.countDocuments({}),
      // Premium is the denormalised `profiles.isPremium` flag (same source the
      // auth /me + leaderboard reads use for premium).
      profiles.countDocuments({ isPremium: true }),
      users.countDocuments({ isBanned: true }),
      users.countDocuments({ emailVerified: true }),
      users.countDocuments({ createdAt: { $gte: since24h } }),
      users.countDocuments({ createdAt: { $gte: since7d } }),
      placements.countDocuments({
        startsAt: { $lte: now },
        expiresAt: { $gt: now },
      }),
      this.sum(wallets, 'balanceCoins'),
      this.sum(gifts, 'priceCoins'),
      this.recentTransactions(coinTx),
    ]);

    return {
      totalUsers,
      premiumUsers,
      bannedUsers,
      verifiedUsers,
      coinsInCirculation,
      giftsValueCoins,
      activeTopPlacements,
      newUsers24h,
      newUsers7d,
      recentTransactions,
    };
  }

  /** Σ of a numeric field across a whole collection (0 when empty). */
  private async sum(
    collection: ReturnType<Connection['collection']>,
    field: string,
  ): Promise<number> {
    const pipeline: AggregationPipeline = [
      { $group: { _id: null, total: { $sum: `$${field}` } } },
    ];
    const rows = await collection.aggregate<{ total: number }>(pipeline).toArray();
    return rows[0]?.total ?? 0;
  }

  /** Newest {@link RECENT_TX_LIMIT} coin-ledger rows, mapped to the contract. */
  private async recentTransactions(
    collection: ReturnType<Connection['collection']>,
  ): Promise<AdminTransaction[]> {
    const rows = (await collection
      .find({}, { projection: { userId: 1, type: 1, delta: 1, createdAt: 1 } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(RECENT_TX_LIMIT)
      .toArray()) as unknown as CoinTxRow[];

    return rows.map((r) => ({
      id: r._id.toString(),
      userId: r.userId.toString(),
      kind: r.type,
      amountCoins: r.delta,
      createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
    }));
  }
}
