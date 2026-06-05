import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

import type { AdminCall, AdminCallList, AdminCallsStats } from '@ruletka/shared-types';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How many recent calls the feed surfaces. */
const RECENT_LIMIT = 25;

/** A `matches` row as read for the recent feed. */
interface MatchRow {
  _id: Types.ObjectId;
  userA?: string;
  userB?: string;
  type?: string;
  startedAt?: Date;
  endedAt?: Date | null;
}

/**
 * Admin calls surface. REAL — reads the analytics-oriented `matches` collection
 * (one row per roulette pairing) by name via the shared connection: totals, the
 * 24h window, the video/voice mix, live (un-ended) calls, and a mean duration.
 */
@Injectable()
export class AdminCallsService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** Volume + modality mix + live count + mean duration. */
  async getStats(): Promise<AdminCallsStats> {
    const matches = this.connection.collection('matches');
    const since24h = new Date(Date.now() - DAY_MS);

    const [totalCalls, calls24h, videoCalls, voiceCalls, liveCalls, durationAgg] =
      await Promise.all([
        matches.countDocuments({}),
        matches.countDocuments({ startedAt: { $gte: since24h } }),
        matches.countDocuments({ type: 'video' }),
        matches.countDocuments({ type: 'voice' }),
        matches.countDocuments({ endedAt: null }),
        matches
          .aggregate<{ avgMs: number }>([
            { $match: { endedAt: { $ne: null } } },
            {
              $group: {
                _id: null,
                avgMs: { $avg: { $subtract: ['$endedAt', '$startedAt'] } },
              },
            },
          ])
          .toArray(),
      ]);

    const avgMs = durationAgg[0]?.avgMs ?? 0;
    return {
      totalCalls,
      calls24h,
      videoCalls,
      voiceCalls,
      liveCalls,
      averageDurationSec: avgMs > 0 ? Math.round(avgMs / 1000) : 0,
    };
  }

  /** The newest {@link RECENT_LIMIT} calls. */
  async getRecent(): Promise<AdminCallList> {
    const rows = (await this.connection
      .collection('matches')
      .find({}, { projection: { userA: 1, userB: 1, type: 1, startedAt: 1, endedAt: 1 } })
      .sort({ startedAt: -1, _id: -1 })
      .limit(RECENT_LIMIT)
      .toArray()) as unknown as MatchRow[];

    return { items: rows.map((r) => this.toCall(r)) };
  }

  /** Map a `matches` row to the admin contract shape. */
  private toCall(r: MatchRow): AdminCall {
    const startedAt = r.startedAt ?? new Date();
    const endedAt = r.endedAt ?? null;
    const durationSec = endedAt
      ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
      : null;
    return {
      id: r._id.toString(),
      type: r.type ?? 'video',
      participantA: this.asObjectId(r.userA),
      participantB: this.asObjectId(r.userB),
      durationSec,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt ? endedAt.toISOString() : null,
    };
  }

  /** `matches` stores participants as plain strings — pass through valid ids only. */
  private asObjectId(value: string | undefined): string | null {
    return value && Types.ObjectId.isValid(value) ? value : (value ?? null);
  }
}
