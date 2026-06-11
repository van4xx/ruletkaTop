import { Types, type Model, type Connection } from 'mongoose';

import {
  ACHIEVEMENTS_CATALOGUE,
  ACHIEVEMENTS_COUNT,
} from '@ruletka/shared-types';

import type { PremiumService } from '../premium/premium.service';
import { AchievementsService, type AchievementsClock } from './achievements.service';
import type { UserAchievementDocument } from './schemas/user-achievement.schema';

/**
 * In-memory state mimicking the `userachievements` collection. The unique
 * `(userId, achievementId, tier)` constraint is enforced by the mock so the
 * service's E11000-trapping idempotency path is exercised end-to-end.
 */
interface UnlockRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  achievementId: string;
  tier: 1 | 2 | 3;
  unlockedAt: Date;
}

/** Minimal Mongo collection mock: just the shapes `readCounters` calls into. */
interface CollectionMock {
  count: number;
  durationMs: number;
  has: boolean;
}

describe('AchievementsService', () => {
  const userId = '507f1f77bcf86cd799439011';
  const userObjectId = new Types.ObjectId(userId);
  let now: Date;
  const clock: AchievementsClock = () => now;

  // Per-counter mock state — the readCounters fan-out reads these.
  let matchesCount = 0;
  let matchesDurationMs = 0;
  let friendshipsAcceptedCount = 0;
  let friendshipsInviteSent = false;
  let friendshipsInviteAccepted = false;
  let purchasesCount = 0;
  let coinsReceivedTotal = 0;
  let giftsSentCount = 0;
  let giftSentOnce = false;
  let giftReceivedOnce = false;
  let messagesSent = 0;
  let chatStarted = false;
  let topPlacementExists = false;
  let dailyBonusClaims = 0;
  let referralCompleted = false;
  let premiumActive = false;
  let accountCreatedAt: Date | null = new Date('2026-01-01T00:00:00.000Z');

  // Storage for unlocks.
  let unlocks: UnlockRow[];

  function makeModel(): Model<UserAchievementDocument> {
    const inferDocument = (row: UnlockRow): UserAchievementDocument =>
      ({
        _id: row._id,
        userId: row.userId,
        achievementId: row.achievementId,
        tier: row.tier,
        unlockedAt: row.unlockedAt,
      }) as unknown as UserAchievementDocument;

    const exec = <T>(value: T) => ({ exec: () => Promise.resolve(value) });

    return {
      find: (filter: { userId: Types.ObjectId }) => {
        const rows = unlocks
          .filter((r) => r.userId.toString() === filter.userId.toString())
          .sort((a, b) => b.unlockedAt.getTime() - a.unlockedAt.getTime())
          .map(inferDocument);
        return {
          sort: () => ({ exec: () => Promise.resolve(rows) }),
        };
      },
      create: async (data: { userId: Types.ObjectId; achievementId: string; tier: 1 | 2 | 3; unlockedAt: Date }) => {
        const dup = unlocks.find(
          (r) =>
            r.userId.toString() === data.userId.toString() &&
            r.achievementId === data.achievementId &&
            r.tier === data.tier,
        );
        if (dup) {
          // Mimic Mongoose duplicate-key error shape.
          const err = new Error('E11000 duplicate key') as Error & { code: number };
          err.code = 11000;
          throw err;
        }
        const row: UnlockRow = {
          _id: new Types.ObjectId(),
          ...data,
        };
        unlocks.push(row);
        return inferDocument(row);
      },
      exec, // unused, satisfies the typing surface
    } as unknown as Model<UserAchievementDocument>;
  }

  /**
   * Build a Mongo connection mock with just `db.collection(name)` → an object
   * whose query methods the service consumes. We hand-route per collection so
   * each branch in `readCounters` lands on the right counter.
   */
  function makeConnection(): Connection {
    const noopCursor = (rows: unknown[]) => ({
      toArray: () => Promise.resolve(rows),
    });
    return {
      db: {
        collection: (name: string) => {
          if (name === 'matches') {
            return {
              aggregate: () =>
                noopCursor(
                  matchesCount === 0
                    ? []
                    : [{ count: matchesCount, durationMs: matchesDurationMs }],
                ),
              countDocuments: () => Promise.resolve(matchesCount),
              findOne: () => Promise.resolve(null),
            };
          }
          if (name === 'friendships') {
            return {
              aggregate: () => noopCursor([]),
              countDocuments: () => Promise.resolve(friendshipsAcceptedCount),
              findOne: (filter: Record<string, unknown>) => {
                if ((filter as { requesterId?: unknown }).requesterId) {
                  return Promise.resolve(friendshipsInviteSent ? { _id: 'x' } : null);
                }
                if ((filter as { recipientId?: unknown }).recipientId) {
                  return Promise.resolve(friendshipsInviteAccepted ? { _id: 'x' } : null);
                }
                return Promise.resolve(null);
              },
            };
          }
          if (name === 'cointransactions') {
            return {
              aggregate: () =>
                noopCursor(coinsReceivedTotal > 0 ? [{ total: coinsReceivedTotal }] : []),
              countDocuments: (filter: { type?: string }) => {
                if (filter.type === 'purchase') return Promise.resolve(purchasesCount);
                return Promise.resolve(0);
              },
              findOne: () => Promise.resolve(null),
            };
          }
          if (name === 'gifttransactions') {
            return {
              aggregate: () => noopCursor([]),
              countDocuments: (filter: { fromUserId?: unknown }) => {
                if (filter.fromUserId) return Promise.resolve(giftsSentCount);
                return Promise.resolve(0);
              },
              findOne: (filter: { fromUserId?: unknown; toUserId?: unknown }) => {
                if (filter.fromUserId) return Promise.resolve(giftSentOnce ? { _id: 'x' } : null);
                if (filter.toUserId) return Promise.resolve(giftReceivedOnce ? { _id: 'x' } : null);
                return Promise.resolve(null);
              },
            };
          }
          if (name === 'messages') {
            return {
              aggregate: () => noopCursor([]),
              countDocuments: () => Promise.resolve(messagesSent),
              findOne: () => Promise.resolve(chatStarted ? { _id: 'x' } : null),
            };
          }
          if (name === 'topplacements') {
            return {
              aggregate: () => noopCursor([]),
              countDocuments: () => Promise.resolve(0),
              findOne: () => Promise.resolve(topPlacementExists ? { _id: 'x' } : null),
            };
          }
          if (name === 'dailybonuses') {
            return {
              aggregate: () => noopCursor([]),
              countDocuments: () => Promise.resolve(0),
              findOne: () => Promise.resolve(dailyBonusClaims > 0 ? { totalClaims: dailyBonusClaims, streak: Math.min(dailyBonusClaims, 7) } : null),
            };
          }
          if (name === 'referrals') {
            return {
              aggregate: () => noopCursor([]),
              countDocuments: () => Promise.resolve(0),
              findOne: () => Promise.resolve(referralCompleted ? { _id: 'x' } : null),
            };
          }
          if (name === 'users') {
            return {
              aggregate: () => noopCursor([]),
              countDocuments: () => Promise.resolve(0),
              findOne: () => Promise.resolve(accountCreatedAt ? { createdAt: accountCreatedAt } : null),
            };
          }
          return {
            aggregate: () => noopCursor([]),
            countDocuments: () => Promise.resolve(0),
            findOne: () => Promise.resolve(null),
          };
        },
      },
    } as unknown as Connection;
  }

  let premium: PremiumService;
  let service: AchievementsService;

  beforeEach(() => {
    now = new Date('2026-06-10T12:00:00.000Z');
    matchesCount = 0;
    matchesDurationMs = 0;
    friendshipsAcceptedCount = 0;
    friendshipsInviteSent = false;
    friendshipsInviteAccepted = false;
    purchasesCount = 0;
    coinsReceivedTotal = 0;
    giftsSentCount = 0;
    giftSentOnce = false;
    giftReceivedOnce = false;
    messagesSent = 0;
    chatStarted = false;
    topPlacementExists = false;
    dailyBonusClaims = 0;
    referralCompleted = false;
    premiumActive = false;
    accountCreatedAt = new Date('2026-01-01T00:00:00.000Z');
    unlocks = [];

    premium = {
      isPremium: jest.fn().mockImplementation(async () => premiumActive),
    } as unknown as PremiumService;

    service = new AchievementsService(makeModel(), makeConnection(), premium, clock);
  });

  // ── Catalogue invariants ──────────────────────────────────────────────────

  it('exports a catalogue with at least 30 entries across all 8 categories', () => {
    expect(ACHIEVEMENTS_COUNT).toBeGreaterThanOrEqual(30);
    const categories = new Set(ACHIEVEMENTS_CATALOGUE.map((e) => e.category));
    expect(categories.size).toBe(8);
    expect(categories).toEqual(
      new Set(['time', 'conversation', 'friends', 'economy', 'leaderboard', 'social', 'streak', 'hidden']),
    );
  });

  it('catalogue ids are all unique and tiers are strictly monotonic', () => {
    const ids = new Set<string>();
    for (const entry of ACHIEVEMENTS_CATALOGUE) {
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
      for (let i = 1; i < entry.tiers.length; i += 1) {
        expect(entry.tiers[i]).toBeGreaterThan(entry.tiers[i - 1]!);
      }
    }
  });

  it('catalogue endpoint shape is the wire-safe projection (no Lucide components)', () => {
    const catalogue = service.getCatalogue();
    expect(catalogue.length).toBe(ACHIEVEMENTS_COUNT);
    for (const row of catalogue) {
      expect(typeof row.id).toBe('string');
      expect(typeof row.category).toBe('string');
      expect(typeof row.icon).toBe('string');
      expect(Array.isArray(row.tiers)).toBe(true);
    }
  });

  // ── checkAndUnlock: firstCall ──────────────────────────────────────────

  it('firstCall unlocks when a call event fires for a user with 0 prior calls', async () => {
    matchesCount = 1;
    matchesDurationMs = 5 * 60_000; // 5 minutes — not enough for `minutes-60`

    const unlocked = await service.checkAndUnlock(userId, 'call_end');

    const firstCall = unlocked.find((u) => u.achievementId === 'first-call');
    expect(firstCall).toBeDefined();
    expect(firstCall?.tier).toBe(1);
  });

  // ── checkAndUnlock: tier progression ─────────────────────────────────

  it('calls-100 tier-progresses 100 → 500 → 1000 across separate call events', async () => {
    // Fire at 100 calls — Bronze.
    matchesCount = 100;
    const wave1 = await service.checkAndUnlock(userId, 'call_end');
    const calls100Bronze = wave1.find((u) => u.achievementId === 'calls-100');
    expect(calls100Bronze?.tier).toBe(1);

    // Fire at 500 calls — Silver lands (no Bronze re-fire).
    matchesCount = 500;
    const wave2 = await service.checkAndUnlock(userId, 'call_end');
    const calls100Silver = wave2.find((u) => u.achievementId === 'calls-100' && u.tier === 2);
    expect(calls100Silver).toBeDefined();
    expect(wave2.filter((u) => u.achievementId === 'calls-100' && u.tier === 1)).toEqual([]);

    // Fire at 1000 calls — Gold lands.
    matchesCount = 1000;
    const wave3 = await service.checkAndUnlock(userId, 'call_end');
    const calls100Gold = wave3.find((u) => u.achievementId === 'calls-100' && u.tier === 3);
    expect(calls100Gold).toBeDefined();
  });

  // ── Idempotency ─────────────────────────────────────────────────────

  it('idempotent second unlock of the same (user, achievement, tier) is a no-op', async () => {
    matchesCount = 1;
    const wave1 = await service.checkAndUnlock(userId, 'call_end');
    expect(wave1.find((u) => u.achievementId === 'first-call')).toBeDefined();
    const after1 = unlocks.length;

    // Same event fires again — DB write hits the unique index and the service
    // silently no-ops. `unlocks.length` does NOT grow.
    const wave2 = await service.checkAndUnlock(userId, 'call_end');
    expect(wave2.find((u) => u.achievementId === 'first-call')).toBeUndefined();
    expect(unlocks.length).toBe(after1);
  });

  // ── /me read ───────────────────────────────────────────────────────

  it('GET /me returns unlocked + progress + the checkedAt cursor', async () => {
    matchesCount = 1; // unlock first-call
    await service.checkAndUnlock(userId, 'call_end');

    // Pretend the user is 1-day old + has 3 calls to drive a progress row.
    accountCreatedAt = new Date(now.getTime() - 24 * 3600 * 1000);
    matchesCount = 3;

    const me = await service.getMyAchievements(userId, accountCreatedAt);
    expect(me.unlocked.find((u) => u.achievementId === 'first-call')).toBeDefined();
    // `calls-10` is uncapped — 3/10 progress visible.
    const calls10 = me.progress.find((p) => p.achievementId === 'calls-10');
    expect(calls10).toBeDefined();
    expect(calls10?.current).toBe(3);
    expect(calls10?.target).toBe(10);
    expect(calls10?.tier).toBe(1);
    expect(typeof me.checkedAt).toBe('string');
  });

  // ── Catalogue endpoint is reachable unauthenticated ──────────────

  it('getCatalogue does not require any auth context — pure function over the static catalogue', () => {
    const catalogue = service.getCatalogue();
    expect(catalogue.length).toBe(ACHIEVEMENTS_COUNT);
    // Hidden flag is preserved for the easter eggs.
    const nightOwl = catalogue.find((r) => r.id === 'night-owl');
    expect(nightOwl?.hidden).toBe(true);
  });

  // ── checkAndUnlock NEVER throws ───────────────────────────────────

  it('checkAndUnlock returns [] on an invalid userId without throwing', async () => {
    const result = await service.checkAndUnlock('not-an-objectid', 'call_end');
    expect(result).toEqual([]);
  });

  // ── Hidden easter eggs ────────────────────────────────────────────

  it('nightOwl unlocks only on a call_end with UTC hour 2..5', async () => {
    const wave1 = await service.checkAndUnlock(userId, 'call_end', { hour: 3 });
    expect(wave1.find((u) => u.achievementId === 'night-owl')).toBeDefined();
  });

  it('earlyBird unlocks only on a call_end with UTC hour 5..8', async () => {
    const wave1 = await service.checkAndUnlock(userId, 'call_end', { hour: 6 });
    expect(wave1.find((u) => u.achievementId === 'early-bird')).toBeDefined();
  });

  it('nightOwl does NOT fire outside the 2..5 window', async () => {
    const wave = await service.checkAndUnlock(userId, 'call_end', { hour: 13 });
    expect(wave.find((u) => u.achievementId === 'night-owl')).toBeUndefined();
    expect(wave.find((u) => u.achievementId === 'early-bird')).toBeUndefined();
  });

  // ── Account age (time-based) ──────────────────────────────────────

  it('day-1 unlocks when the account is at least 1 day old (session event)', async () => {
    accountCreatedAt = new Date(now.getTime() - 25 * 3600 * 1000); // 25h old
    const wave = await service.checkAndUnlock(userId, 'session', {}, accountCreatedAt);
    expect(wave.find((u) => u.achievementId === 'day-1')).toBeDefined();
  });

  it('first-hour unlocks after the account is at least 1h old', async () => {
    accountCreatedAt = new Date(now.getTime() - 2 * 3600 * 1000); // 2h old
    const wave = await service.checkAndUnlock(userId, 'session', {}, accountCreatedAt);
    expect(wave.find((u) => u.achievementId === 'first-hour')).toBeDefined();
  });
});
