import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Redis } from 'ioredis';
import { Connection } from 'mongoose';

import type {
  AdminAnalyticsOverview,
  AdminTimeseries,
  AdminTimeseriesPoint,
  AdminTimeseriesQuery,
} from '@ruletka/shared-types';

import { REDIS_CLIENT } from '../../redis/redis.constants';

/** A raw aggregation pipeline as the native MongoDB driver consumes it. */
type AggregationPipeline = Record<string, unknown>[];

const DAY_MS = 24 * 60 * 60 * 1000;
/** Cap the presence SCAN so a huge keyspace can't stall the dashboard. */
const ONLINE_SCAN_LIMIT = 50_000;

/** Number of days each timeseries range spans. */
const RANGE_DAYS: Record<AdminTimeseriesQuery['range'], number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/**
 * Read-only analytics for the admin dashboard, computed ON READ from existing
 * collections + Redis presence — no new tracking. Collections are read by NAME
 * via the shared {@link Connection} (the same decoupled approach
 * {@link AdminEconomyService} / {@link LeaderboardService} use), so this service
 * takes no hard dependency on the feature modules it reports on.
 *
 * Sources:
 *  - population → `users` / `profiles` (totals, new, premium, banned);
 *  - online → count of live `presence:status:*` keys in Redis;
 *  - coins → Σ `wallets.balanceCoins`;
 *  - revenue → Σ `payments.amount` where `status='completed'`;
 *  - calls → `matches` (totals + 24h);
 *  - open reports → `reports` + `moderation_events` with `status='open'`.
 */
@Injectable()
export class AdminAnalyticsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Build the headline KPI overview. */
  async getOverview(): Promise<AdminAnalyticsOverview> {
    const now = new Date();
    const since24h = new Date(now.getTime() - DAY_MS);
    const since7d = new Date(now.getTime() - 7 * DAY_MS);

    const users = this.connection.collection('users');
    const profiles = this.connection.collection('profiles');
    const wallets = this.connection.collection('wallets');
    const payments = this.connection.collection('payments');
    const matches = this.connection.collection('matches');
    const reports = this.connection.collection('reports');
    const events = this.connection.collection('moderation_events');

    const [
      totalUsers,
      newUsers24h,
      newUsers7d,
      premiumUsers,
      bannedUsers,
      coinsInCirculation,
      revenueRubTotal,
      revenueRub24h,
      callsTotal,
      calls24h,
      openReportsRaw,
      openEventsRaw,
      onlineUsers,
    ] = await Promise.all([
      users.countDocuments({}),
      users.countDocuments({ createdAt: { $gte: since24h } }),
      users.countDocuments({ createdAt: { $gte: since7d } }),
      profiles.countDocuments({ isPremium: true }),
      users.countDocuments({ isBanned: true }),
      this.sum(wallets, 'balanceCoins', {}),
      this.sum(payments, 'amount', { status: 'completed' }),
      this.sum(payments, 'amount', { status: 'completed', createdAt: { $gte: since24h } }),
      matches.countDocuments({}),
      matches.countDocuments({ startedAt: { $gte: since24h } }),
      reports.countDocuments({ status: 'open' }).catch(() => 0),
      events.countDocuments({ status: 'open' }).catch(() => 0),
      this.countOnline(),
    ]);

    return {
      totalUsers,
      onlineUsers,
      newUsers24h,
      newUsers7d,
      premiumUsers,
      bannedUsers,
      coinsInCirculation,
      revenueRubTotal,
      revenueRub24h,
      callsTotal,
      calls24h,
      openReports: openReportsRaw + openEventsRaw,
    };
  }

  /**
   * A per-day timeseries for one metric over the requested range. Buckets are
   * built server-side from the source collection's date field and zero-filled
   * so the client always gets a contiguous daily series.
   */
  async getTimeseries(query: AdminTimeseriesQuery): Promise<AdminTimeseries> {
    const days = RANGE_DAYS[query.range];
    const points = await this.buildSeries(query.metric, days);
    return { metric: query.metric, range: query.range, points };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Σ of a numeric field across a filtered collection (0 when empty). */
  private async sum(
    collection: ReturnType<Connection['collection']>,
    field: string,
    match: Record<string, unknown>,
  ): Promise<number> {
    const pipeline: AggregationPipeline = [
      { $match: match },
      { $group: { _id: null, total: { $sum: `$${field}` } } },
    ];
    const rows = await collection.aggregate<{ total: number }>(pipeline).toArray();
    return rows[0]?.total ?? 0;
  }

  /**
   * Count online users = live `presence:status:*` keys in Redis. Uses a bounded
   * SCAN (non-blocking, cursor-based) rather than `KEYS` so it is safe on a
   * large keyspace; caps at {@link ONLINE_SCAN_LIMIT} to keep the dashboard snappy.
   */
  private async countOnline(): Promise<number> {
    let cursor = '0';
    let count = 0;
    do {
      const [next, keys] = (await this.redis.scan(
        cursor,
        'MATCH',
        'presence:status:*',
        'COUNT',
        1000,
      )) as [string, string[]];
      cursor = next;
      count += keys.length;
      if (count >= ONLINE_SCAN_LIMIT) {
        break;
      }
    } while (cursor !== '0');
    return count;
  }

  /**
   * Build a zero-filled per-day series for `metric` over the last `days` days.
   * `signups` counts `users` by `createdAt`; `calls` counts `matches` by
   * `startedAt`; `revenue` sums completed `payments.amount` by `createdAt`.
   */
  private async buildSeries(
    metric: AdminTimeseriesQuery['metric'],
    days: number,
  ): Promise<AdminTimeseriesPoint[]> {
    const since = new Date(Date.now() - (days - 1) * DAY_MS);
    since.setUTCHours(0, 0, 0, 0);

    const { collection, dateField, valueExpr, match } = this.seriesSource(metric, since);

    const pipeline: AggregationPipeline = [
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: `$${dateField}`, timezone: 'UTC' },
          },
          value: valueExpr,
        },
      },
    ];
    const rows = await this.connection
      .collection(collection)
      .aggregate<{ _id: string; value: number }>(pipeline)
      .toArray();

    const byDay = new Map(rows.map((r) => [r._id, r.value]));

    // Zero-fill every day in the window so the client renders a contiguous line.
    const points: AdminTimeseriesPoint[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since.getTime() + i * DAY_MS);
      const key = d.toISOString().slice(0, 10);
      points.push({ date: key, value: byDay.get(key) ?? 0 });
    }
    return points;
  }

  /** Resolve the collection/field/aggregate for a given metric. */
  private seriesSource(
    metric: AdminTimeseriesQuery['metric'],
    since: Date,
  ): {
    collection: string;
    dateField: string;
    valueExpr: Record<string, unknown>;
    match: Record<string, unknown>;
  } {
    switch (metric) {
      case 'calls':
        return {
          collection: 'matches',
          dateField: 'startedAt',
          valueExpr: { $sum: 1 },
          match: { startedAt: { $gte: since } },
        };
      case 'revenue':
        return {
          collection: 'payments',
          dateField: 'createdAt',
          valueExpr: { $sum: '$amount' },
          match: { status: 'completed', createdAt: { $gte: since } },
        };
      case 'signups':
      default:
        return {
          collection: 'users',
          dateField: 'createdAt',
          valueExpr: { $sum: 1 },
          match: { createdAt: { $gte: since } },
        };
    }
  }
}
