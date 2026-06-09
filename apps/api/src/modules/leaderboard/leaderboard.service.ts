import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Redis } from 'ioredis';
import { Connection, Types } from 'mongoose';

import { REDIS_CLIENT } from '../../redis/redis.constants';

/**
 * A raw aggregation pipeline as the NATIVE MongoDB driver consumes it. We read
 * collections via `connection.collection(name)` (the native driver), whose
 * `aggregate(pipeline?: Document[])` takes plain stage objects — NOT Mongoose's
 * `PipelineStage` union (that's for `Model.aggregate`). `Record<string, unknown>[]`
 * is assignable to the driver's `Document[]` and keeps the stages typed without a
 * separate `mongodb` dependency.
 */
type AggregationPipeline = Record<string, unknown>[];

import type {
  LeaderboardEntry,
  LeaderboardMetric,
  LeaderboardQuery,
  LeaderboardResponse,
} from '@ruletka/shared-types';

/** Milliseconds in one day (for the `top` cumulative-days metric). */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * TTL (seconds) of the SHARED leaderboard cache entries. Leaderboards are
 * stale-tolerant — a 45s window is imperceptible to viewers but collapses what
 * was an UNINDEXED full-collection `$group` (run twice per request) down to one
 * scan per metric per window across all concurrent callers.
 */
export const LEADERBOARD_CACHE_TTL_SECONDS = 45;

/** Cache key for the top-`limit` ranked slice of a metric. */
function topScoresKey(metric: LeaderboardMetric, limit: number): string {
  return `leaderboard:top:${metric}:${limit}`;
}

/**
 * Cache key for the FULL grouped score list of a metric (every user's summed
 * score, no `$match`/`$count`). The caller's `me` rank is derived from this
 * shared grouping in-memory, so the per-user count never re-scans the
 * collection. Only the `gifts`/`top` metrics group; `coins` counts directly.
 */
function aheadGroupingKey(metric: 'gifts' | 'top'): string {
  return `leaderboard:ahead:${metric}`;
}

/** Intermediate aggregation row before the profile join: `(userId, score)`. */
interface ScoredUser {
  userId: string;
  score: number;
}

/**
 * Read-only leaderboard built ON READ from existing collections — no new
 * tracking. Three metrics, each a single Mongoose aggregation capped at the
 * requested `limit`:
 *  - `gifts`  — sum of `priceCoins` of gift transactions RECEIVED, per recipient
 *               (`gifttransactions` grouped by `toUserId`);
 *  - `coins`  — current wallet balance (`wallets.balanceCoins`), descending;
 *  - `top`    — cumulative days held in the Top feed (sum of each placement's
 *               ELAPSED `[startsAt, min(expiresAt, now))` span in `topplacements`),
 *               per user — future, not-yet-earned days are never counted.
 *
 * Each ranked slice is joined to the `profiles` collection for the display
 * fields (nickname / avatar / premium). The caller's own rank is returned as
 * `me` when they fall outside the returned slice (computed without scanning the
 * whole board — we only count how many users out-score them).
 *
 * ── Caching ────────────────────────────────────────────────────────────────
 * The `gifts`/`top` metrics group an UNINDEXED full collection, which is far too
 * costly to run on every request (it previously ran TWICE per call — once for
 * the board, once for the `me` rank). Two SHARED, stale-tolerant results are
 * cached in Redis with a short TTL ({@link LEADERBOARD_CACHE_TTL_SECONDS}):
 *  1. the top-`limit` ranked slice (`topScores`), and
 *  2. the full grouped score list used to place the caller (`aheadGrouping`).
 * The per-caller `me` rank is computed in-memory from (2) and is NEVER cached
 * wholesale, so it stays correct per user. Concurrent requests within a window
 * are collapsed to a single scan via an in-process single-flight map.
 *
 * Collections are read by NAME via the shared connection (same approach the
 * profiles/friends/chat services use for cross-collection reads), so this module
 * takes no dependency on the economy/profile modules.
 */
@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  /**
   * In-flight cache-miss computations, keyed by Redis cache key. Collapses the
   * thundering herd: concurrent callers that miss the SAME key on this node
   * await the SAME scan rather than each issuing their own full-collection
   * `$group`. Entries are removed as soon as the underlying promise settles.
   */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Build the leaderboard for `query.metric`, top `query.limit` entries, plus
   * the caller's own rank as `me` when they're not already in the slice.
   */
  async getLeaderboard(
    query: LeaderboardQuery,
    callerUserId: string,
  ): Promise<LeaderboardResponse> {
    const scored = await this.topScores(query.metric, query.limit);

    // Defence-in-depth: drop tombstoned (`deletedAt`) / banned accounts from the
    // board so a torn-down or sanctioned user can never surface in a public
    // ranking even if their source-collection rows (wallet/gifts/placements)
    // still carry score. Resolved against the `users` source-of-truth in one $in.
    const dead = await this.deadUserIds(scored.map((s) => s.userId));

    // Join the display profile for the ranked slice in one batched $in.
    const profiles = await this.loadProfiles(scored.map((s) => s.userId));
    const entries: LeaderboardEntry[] = [];
    scored.forEach((row) => {
      if (dead.has(row.userId)) {
        // Tombstoned / banned → excluded from the public board entirely.
        return;
      }
      const profile = profiles.get(row.userId);
      if (!profile) {
        // Skip users whose profile no longer resolves rather than break ranks.
        return;
      }
      entries.push({
        rank: entries.length + 1,
        userId: row.userId,
        nickname: profile.nickname,
        avatarUrl: profile.avatarUrl,
        isPremium: profile.isPremium,
        score: row.score,
      });
    });

    const me = await this.resolveMe(query.metric, callerUserId, entries);
    return { metric: query.metric, entries, me };
  }

  // ── Shared-result cache ──────────────────────────────────────────────────────

  /**
   * Serve a JSON-serialisable SHARED result from Redis, recomputing on miss.
   * Within a node, concurrent misses on the same `key` are collapsed to a single
   * `compute()` (single-flight) so one scan fills the window for everyone. All
   * cache I/O is best-effort: a Redis hiccup degrades to a direct `compute()`
   * (correctness over the cache), never throwing into the request path.
   */
  private async cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
    try {
      const hit = await this.redis.get(key);
      if (hit != null) {
        return JSON.parse(hit) as T;
      }
    } catch (err) {
      this.logger.debug(`leaderboard cache read failed for ${key}: ${asMessage(err)}`);
    }

    // Collapse concurrent misses on this node to one computation per window.
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const pending = (async () => {
      const value = await compute();
      try {
        await this.redis.set(
          key,
          JSON.stringify(value),
          'EX',
          LEADERBOARD_CACHE_TTL_SECONDS,
        );
      } catch (err) {
        this.logger.debug(`leaderboard cache write failed for ${key}: ${asMessage(err)}`);
      }
      return value;
    })().finally(() => {
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, pending);
    return pending;
  }

  // ── Metric scoring ───────────────────────────────────────────────────────────

  /**
   * Top `limit` `(userId, score)` rows for a metric, highest score first. The
   * SHARED slice is cached per `(metric, limit)` — see {@link cached}.
   */
  private async topScores(metric: LeaderboardMetric, limit: number): Promise<ScoredUser[]> {
    return this.cached(topScoresKey(metric, limit), () => this.computeTopScores(metric, limit));
  }

  /** Run the (uncached) aggregation that produces the top-`limit` slice. */
  private async computeTopScores(
    metric: LeaderboardMetric,
    limit: number,
  ): Promise<ScoredUser[]> {
    const { collection, pipeline } = this.buildScorePipeline(metric, limit, Date.now());
    const rows = await this.connection
      .collection(collection)
      .aggregate<{ _id: Types.ObjectId; score: number }>(pipeline)
      .toArray();
    return rows
      .filter((r) => r._id != null)
      .map((r) => ({ userId: r._id.toString(), score: round(r.score) }));
  }

  /**
   * The aggregation source collection + pipeline for a metric. Each pipeline
   * projects `{ _id: <userId>, score: <number> }` sorted by score desc, capped.
   * `now` (epoch ms) clamps the `top` metric's placement span to its ELAPSED
   * portion so future, not-yet-earned days are never counted.
   */
  private buildScorePipeline(
    metric: LeaderboardMetric,
    limit: number,
    now: number,
  ): { collection: string; pipeline: AggregationPipeline } {
    switch (metric) {
      case 'coins':
        // Wallet balance leaderboard: balance desc, skip empty wallets.
        return {
          collection: 'wallets',
          pipeline: [
            { $match: { balanceCoins: { $gt: 0 } } },
            { $project: { _id: '$userId', score: '$balanceCoins' } },
            { $sort: { score: -1 } },
            { $limit: limit },
          ],
        };
      case 'top':
        // Cumulative days in the Top feed: sum each placement's ELAPSED span.
        return {
          collection: 'topplacements',
          pipeline: [
            {
              $group: {
                _id: '$userId',
                score: { $sum: elapsedDaysExpr(now) },
              },
            },
            { $match: { score: { $gt: 0 } } },
            { $sort: { score: -1 } },
            { $limit: limit },
          ],
        };
      case 'gifts':
      default:
        // Received-gift value: sum priceCoins of gifts addressed to each user.
        return {
          collection: 'gifttransactions',
          pipeline: [
            { $group: { _id: '$toUserId', score: { $sum: '$priceCoins' } } },
            { $match: { score: { $gt: 0 } } },
            { $sort: { score: -1 } },
            { $limit: limit },
          ],
        };
    }
  }

  // ── Caller's own rank ──────────────────────────────────────────────────────

  /**
   * Resolve the caller's `me` entry. Returns `null` when the caller is already
   * in `slice` (no need to repeat them) or has no score. Otherwise computes
   * their exact rank as `1 + (number of users strictly out-scoring them)`.
   */
  private async resolveMe(
    metric: LeaderboardMetric,
    callerUserId: string,
    slice: LeaderboardEntry[],
  ): Promise<LeaderboardEntry | null> {
    if (!Types.ObjectId.isValid(callerUserId)) {
      return null;
    }
    if (slice.some((e) => e.userId === callerUserId)) {
      return null;
    }
    // A tombstoned / banned caller never gets a public `me` rank either.
    if ((await this.deadUserIds([callerUserId])).has(callerUserId)) {
      return null;
    }

    const myScore = await this.scoreForUser(metric, callerUserId);
    if (myScore <= 0) {
      return null;
    }
    const ahead = await this.countUsersAhead(metric, myScore);

    const profile = (await this.loadProfiles([callerUserId])).get(callerUserId);
    if (!profile) {
      return null;
    }
    return {
      rank: ahead + 1,
      userId: callerUserId,
      nickname: profile.nickname,
      avatarUrl: profile.avatarUrl,
      isPremium: profile.isPremium,
      score: round(myScore),
    };
  }

  /** The caller's own score for a metric (0 when they have none). */
  private async scoreForUser(metric: LeaderboardMetric, userId: string): Promise<number> {
    const id = new Types.ObjectId(userId);
    if (metric === 'coins') {
      const wallet = await this.connection
        .collection('wallets')
        .findOne({ userId: id }, { projection: { balanceCoins: 1 } });
      return (wallet as { balanceCoins?: number } | null)?.balanceCoins ?? 0;
    }
    if (metric === 'top') {
      const rows = await this.connection
        .collection('topplacements')
        .aggregate<{ score: number }>([
          { $match: { userId: id } },
          {
            $group: {
              _id: null,
              // Same ELAPSED-only clamp as the board, so `me` agrees with it.
              score: { $sum: elapsedDaysExpr(Date.now()) },
            },
          },
        ])
        .toArray();
      return rows[0]?.score ?? 0;
    }
    // gifts
    const rows = await this.connection
      .collection('gifttransactions')
      .aggregate<{ score: number }>([
        { $match: { toUserId: id } },
        { $group: { _id: null, score: { $sum: '$priceCoins' } } },
      ])
      .toArray();
    return rows[0]?.score ?? 0;
  }

  /**
   * Count users whose score for a metric is strictly GREATER than `myScore`
   * (so the caller's rank is that count + 1).
   *
   * For `coins` this is a direct, indexable `countDocuments`. For `gifts`/`top`
   * the per-user count is derived in-memory from the SHARED, cached grouping of
   * every user's score ({@link aheadGrouping}) — so the expensive full-collection
   * `$group` runs at most once per window across all callers, while the count
   * itself stays correct per user.
   */
  private async countUsersAhead(metric: LeaderboardMetric, myScore: number): Promise<number> {
    if (metric === 'coins') {
      return this.connection
        .collection('wallets')
        .countDocuments({ balanceCoins: { $gt: myScore } });
    }
    const grouped = await this.aheadGrouping(metric === 'top' ? 'top' : 'gifts');
    return grouped.reduce((n, score) => (score > myScore ? n + 1 : n), 0);
  }

  /**
   * The SHARED, cached list of every user's summed score for a `gifts`/`top`
   * metric (no `$match`/`$count` — the per-caller comparison is applied
   * in-memory by {@link countUsersAhead}). Cached per metric so the full-scan
   * grouping runs once per window for all callers.
   */
  private async aheadGrouping(metric: 'gifts' | 'top'): Promise<number[]> {
    return this.cached(aheadGroupingKey(metric), () => this.computeAheadGrouping(metric));
  }

  /** Run the (uncached) full-collection grouping behind {@link aheadGrouping}. */
  private async computeAheadGrouping(metric: 'gifts' | 'top'): Promise<number[]> {
    const { collection, groupId, sumExpr } = AHEAD_GROUPING[metric];
    const rows = await this.connection
      .collection(collection)
      .aggregate<{ score: number }>([
        { $group: { _id: groupId, score: { $sum: sumExpr(Date.now()) } } },
        { $match: { score: { $gt: 0 } } },
        { $project: { _id: 0, score: 1 } },
      ])
      .toArray();
    return rows.map((r) => r.score);
  }

  // ── Tombstone / ban guard ────────────────────────────────────────────────────

  /**
   * Resolve, in ONE `$in` query against the `users` source-of-truth, which of
   * the given ids belong to a TORN-DOWN (`deletedAt != null`) or BANNED
   * (`isBanned === true`) account — those must never appear on a public board.
   * Returns a set of the offending userId strings (empty when all are live).
   */
  private async deadUserIds(userIds: readonly string[]): Promise<Set<string>> {
    const dead = new Set<string>();
    const objectIds = userIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (objectIds.length === 0) {
      return dead;
    }
    const docs = await this.connection
      .collection('users')
      .find(
        {
          _id: { $in: objectIds },
          $or: [{ deletedAt: { $ne: null } }, { isBanned: true }],
        },
        { projection: { _id: 1 } },
      )
      .toArray();
    for (const doc of docs) {
      const id = (doc as { _id?: Types.ObjectId })._id;
      if (id) {
        dead.add(id.toString());
      }
    }
    return dead;
  }

  // ── Profile join ─────────────────────────────────────────────────────────────

  /**
   * Batch-load minimal display profiles for a set of user ids in ONE `$in`
   * query against the `profiles` collection, as `userId → fields`.
   */
  private async loadProfiles(
    userIds: readonly string[],
  ): Promise<Map<string, { nickname: string; avatarUrl: string | null; isPremium: boolean }>> {
    const out = new Map<
      string,
      { nickname: string; avatarUrl: string | null; isPremium: boolean }
    >();
    if (userIds.length === 0) {
      return out;
    }
    const objectIds = userIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    const docs = await this.connection
      .collection('profiles')
      .find(
        { userId: { $in: objectIds } },
        { projection: { userId: 1, nickname: 1, avatarUrl: 1, isPremium: 1 } },
      )
      .toArray();

    for (const doc of docs) {
      const p = doc as unknown as {
        userId: Types.ObjectId;
        nickname?: string;
        avatarUrl?: string | null;
        isPremium?: boolean;
      };
      out.set(p.userId.toString(), {
        nickname: p.nickname ?? '',
        avatarUrl: p.avatarUrl ?? null,
        isPremium: p.isPremium ?? false,
      });
    }
    return out;
  }
}

/**
 * Days held in the Top feed for ONE placement, clamped to the ELAPSED portion of
 * its `[startsAt, expiresAt)` window: `max(min(expiresAt, now) - startsAt, 0) /
 * DAY_MS`. This stops a freshly-bought placement from inflating a user's `top`
 * score with its FUTURE, not-yet-earned days at purchase time — and keeps the
 * board and the caller's `me` rank in agreement since both use this expression.
 * `now` is the current epoch-ms (threaded in by the caller).
 */
function elapsedDaysExpr(now: number): Record<string, unknown> {
  return {
    $divide: [
      {
        $max: [
          { $subtract: [{ $min: ['$expiresAt', new Date(now)] }, '$startsAt'] },
          0,
        ],
      },
      DAY_MS,
    ],
  };
}

/**
 * Grouping config for {@link LeaderboardService.computeAheadGrouping} per metric
 * (the `coins` metric is handled separately as a direct count, no grouping).
 * `sumExpr` is a function of `now` so the `top` metric can clamp each placement's
 * span to its elapsed portion — exactly as the board pipeline does.
 */
const AHEAD_GROUPING: Record<
  'gifts' | 'top',
  { collection: string; groupId: string; sumExpr: (now: number) => unknown }
> = {
  gifts: {
    collection: 'gifttransactions',
    groupId: '$toUserId',
    sumExpr: () => '$priceCoins',
  },
  top: {
    collection: 'topplacements',
    groupId: '$userId',
    sumExpr: (now) => elapsedDaysExpr(now),
  },
};

/** Round a score to 2 dp (the `top` days metric is fractional; others integer). */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Narrows an unknown thrown value to a printable message. */
function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
