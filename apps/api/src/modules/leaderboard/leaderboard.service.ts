import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

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
 *               `[startsAt, expiresAt)` span in `topplacements`), per user.
 *
 * Each ranked slice is joined to the `profiles` collection for the display
 * fields (nickname / avatar / premium). The caller's own rank is returned as
 * `me` when they fall outside the returned slice (computed without scanning the
 * whole board — we only count how many users out-score them).
 *
 * Collections are read by NAME via the shared connection (same approach the
 * profiles/friends/chat services use for cross-collection reads), so this module
 * takes no dependency on the economy/profile modules.
 */
@Injectable()
export class LeaderboardService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

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

  // ── Metric scoring ───────────────────────────────────────────────────────────

  /** Top `limit` `(userId, score)` rows for a metric, highest score first. */
  private async topScores(metric: LeaderboardMetric, limit: number): Promise<ScoredUser[]> {
    const { collection, pipeline } = this.buildScorePipeline(metric, limit);
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
   */
  private buildScorePipeline(
    metric: LeaderboardMetric,
    limit: number,
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
        // Cumulative days in the Top feed: sum each placement's span in days.
        return {
          collection: 'topplacements',
          pipeline: [
            {
              $group: {
                _id: '$userId',
                score: {
                  $sum: {
                    $divide: [{ $subtract: ['$expiresAt', '$startsAt'] }, DAY_MS],
                  },
                },
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
              score: {
                $sum: { $divide: [{ $subtract: ['$expiresAt', '$startsAt'] }, DAY_MS] },
              },
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
   * (so the caller's rank is that count + 1). Computed with the same grouping as
   * the board but reduced to a single count — no full sort/scan returned.
   */
  private async countUsersAhead(metric: LeaderboardMetric, myScore: number): Promise<number> {
    if (metric === 'coins') {
      return this.connection
        .collection('wallets')
        .countDocuments({ balanceCoins: { $gt: myScore } });
    }
    const { collection, groupId, sumExpr } = AHEAD_GROUPING[metric === 'top' ? 'top' : 'gifts'];
    const rows = await this.connection
      .collection(collection)
      .aggregate<{ count: number }>([
        { $group: { _id: groupId, score: { $sum: sumExpr } } },
        { $match: { score: { $gt: myScore } } },
        { $count: 'count' },
      ])
      .toArray();
    return rows[0]?.count ?? 0;
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
 * Grouping config for {@link LeaderboardService.countUsersAhead} per metric
 * (the `coins` metric is handled separately as a direct count, no grouping).
 */
const AHEAD_GROUPING: Record<
  'gifts' | 'top',
  { collection: string; groupId: string; sumExpr: unknown }
> = {
  gifts: { collection: 'gifttransactions', groupId: '$toUserId', sumExpr: '$priceCoins' },
  top: {
    collection: 'topplacements',
    groupId: '$userId',
    sumExpr: { $divide: [{ $subtract: ['$expiresAt', '$startsAt'] }, DAY_MS] },
  },
};

/** Round a score to 2 dp (the `top` days metric is fractional; others integer). */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
