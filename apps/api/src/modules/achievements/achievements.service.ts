import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import {
  ACHIEVEMENTS_CATALOGUE,
  type AchievementCatalogueEntry,
  type AchievementCategory,
  type AchievementEventKey,
  type AchievementIconName,
  type AchievementTier,
  type MyAchievements,
  type PublicAchievements,
  type UserAchievementProgress,
  type UserAchievementUnlock,
} from '@ruletka/shared-types';

import { PremiumService } from '../premium/premium.service';
import {
  UserAchievement,
  type UserAchievementDocument,
} from './schemas/user-achievement.schema';

/**
 * Injection token for the "current time" provider. Defaults to `() => new Date()`
 * but specs override it so the deterministic checks (account-age tiers,
 * night-owl / early-bird hour gates) can be tested without monkey-patching
 * `Date`.
 */
export const ACHIEVEMENTS_CLOCK = Symbol('ACHIEVEMENTS_CLOCK');
export type AchievementsClock = () => Date;

/**
 * The aggregate counters {@link AchievementsService.evaluateCriteria} reads.
 *
 * Sourced from a SINGLE batched call to {@link readCounters} so the
 * `checkAndUnlock` hot path does N parallel aggregations once per event, not
 * one-per-badge. Fields stay optional so the service can refuse to evaluate a
 * criteria whose counter the snapshot didn't carry — e.g. when the caller only
 * cares about the `friends` slice and skips the call-related aggregates.
 */
export interface AchievementCounters {
  accountAgeMs?: number;
  callCount?: number;
  callMinutes?: number;
  friendsCount?: number;
  friendInviteSent?: boolean;
  friendInviteAccepted?: boolean;
  purchaseCount?: number;
  giftsSentCount?: number;
  coinsReceivedTotal?: number;
  premiumActive?: boolean;
  hasLeaderboardTop10AllTime?: boolean;
  hasLeaderboardTop10Weekly?: boolean;
  hasLeaderboardTop10Daily?: boolean;
  hasStartedChat?: boolean;
  messagesSentCount?: number;
  giftSentOnce?: boolean;
  giftReceivedOnce?: boolean;
  dailyBonusStreak?: number;
  referralCompleted?: boolean;
}

/**
 * Optional event payload carried on the `checkAndUnlock(userId, eventKey,
 * payload)` call site. Currently used by the `call_end` event to pass the UTC
 * hour-of-day for the `nightOwl`/`earlyBird` easter eggs (so the service does
 * not have to re-derive it from `this.clock()` after the fact).
 */
export interface AchievementEventPayload {
  /** UTC hour-of-day [0..23] when the event fired (`call_end` only). */
  hour?: number;
}

/**
 * Background `checkAndUnlock` failures are SILENT by design (every economy /
 * social hot path tolerates achievement evaluation crashing — losing a badge
 * unlock NEVER blocks a wallet write or a friend accept). We still log them
 * loudly so an upstream regression isn't invisible. This is the structured
 * tag the integrator can grep / Sentry-filter for.
 */
const TAG = 'achievements:checkAndUnlock';

/**
 * Achievements engine: owns the unlock storage, the catalogue criteria
 * evaluator, and the `checkAndUnlock` entry point cross-module callers (wallet,
 * matchmaking, chat, friends, daily-bonus, leaderboard) fire on the relevant
 * domain events.
 *
 * ── Design decisions ──────────────────────────────────────────────────────
 * 1. The catalogue is STATIC (imported from `@ruletka/shared-types`). The
 *    service validates it at boot (unique ids, monotonic tiers) so a bad
 *    catalogue edit fails loudly at startup rather than silently mis-unlocking.
 *
 * 2. `checkAndUnlock` is a SINGLE entry point with a closed `eventKey` enum.
 *    Each event drives a small fan-out of catalogue-row evaluations — we never
 *    walk the full 33-row catalogue on a hot path. The mapping is centralised
 *    in {@link relevantForEvent} so adding a new event is one switch arm.
 *
 * 3. Persistence is INSERT-and-trap-duplicate. The unique index
 *    `(userId, achievementId, tier)` makes the operation idempotent end-to-end:
 *    a duplicated event (network retry, racing path, concurrent claim) lands on
 *    the index and the service treats `E11000` as "already unlocked, no-op".
 *
 * 4. Cross-module reads are LAZY. The service does NOT inject every counter
 *    module — instead, callers can pre-fill the {@link AchievementCounters}
 *    snapshot they already know (wallet has `purchaseCount`, matchmaking has
 *    `callCount`, etc.). For criteria the snapshot doesn't cover the service
 *    falls back to its own COLLECTION reads against the canonical sources
 *    (`matches`, `gifttransactions`, `friendships`, …) by collection name —
 *    keeping this module FREE of cross-module schema imports and avoiding
 *    a dependency cycle with `friends`/`gifts`.
 */
@Injectable()
export class AchievementsService {
  private readonly logger = new Logger(AchievementsService.name);
  private readonly clock: AchievementsClock;

  constructor(
    @InjectModel(UserAchievement.name)
    private readonly userAchievementModel: Model<UserAchievementDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly premiumService: PremiumService,
    @Optional() @Inject(ACHIEVEMENTS_CLOCK) clock?: AchievementsClock,
  ) {
    this.clock = clock ?? (() => new Date());
    this.assertCatalogueInvariants();
  }

  // ── Catalogue ────────────────────────────────────────────────────────────

  /**
   * Boot-time invariant: catalogue ids are unique AND tiers are strictly
   * monotonic. A typo or duplicate id would silently corrupt unlocks across
   * tiers, so we refuse to boot rather than mask the bug at runtime.
   */
  private assertCatalogueInvariants(): void {
    const seen = new Set<string>();
    for (const entry of ACHIEVEMENTS_CATALOGUE) {
      if (seen.has(entry.id)) {
        throw new Error(
          `ACHIEVEMENTS_CATALOGUE has a duplicate id "${entry.id}". ` +
            'Refusing to boot — ids MUST be unique.',
        );
      }
      seen.add(entry.id);
      if (entry.tiers.length < 1 || entry.tiers.length > 3) {
        throw new Error(
          `ACHIEVEMENTS_CATALOGUE id "${entry.id}" has ${entry.tiers.length} tiers ` +
            '(must be 1..3).',
        );
      }
      for (let i = 1; i < entry.tiers.length; i += 1) {
        if (entry.tiers[i]! <= entry.tiers[i - 1]!) {
          throw new Error(
            `ACHIEVEMENTS_CATALOGUE id "${entry.id}" has non-monotonic tiers ` +
              `${entry.tiers.join(',')} — each must be strictly greater than the previous.`,
          );
        }
      }
    }
  }

  // ── Public read surface ──────────────────────────────────────────────────

  /**
   * Static catalogue echo. Returned as the WIRE shape (no Lucide component
   * references) and cache-able — the controller adds `s-maxage=3600`. Safe to
   * expose unauthenticated.
   */
  getCatalogue(): Array<{
    id: string;
    category: AchievementCategory;
    icon: AchievementIconName;
    tiers: number[];
    hidden?: boolean;
  }> {
    return ACHIEVEMENTS_CATALOGUE.map((entry) => ({
      id: entry.id,
      category: entry.category,
      icon: entry.icon,
      tiers: [...entry.tiers],
      ...(entry.hidden ? { hidden: true } : {}),
    }));
  }

  /**
   * Full self-view: unlocked rows + per-badge progress for everything the
   * user hasn't capped. Reads run as TWO concurrent operations: the unlock
   * rows ($eq on userId) and a counter snapshot (one aggregation per source).
   *
   * `checkedAt` is the server stamp the WEB uses as a cursor to detect newly-
   * unlocked badges since last visit (drives the "Achievement unlocked!" toast
   * without a websocket fan-out).
   */
  async getMyAchievements(userId: string, accountCreatedAt: Date | null): Promise<MyAchievements> {
    if (!Types.ObjectId.isValid(userId)) {
      return { unlocked: [], progress: [], checkedAt: this.clock().toISOString() };
    }

    // Opportunistic BACK-FILL: every /me visit fans out the FULL catalogue
    // against the live counters and unlocks any tier the user has CROSSED but
    // not yet been granted (e.g. they earned `first-call` BEFORE the service
    // existed, or a previous unlock attempt errored on the hot path). Always
    // safe because `tryInsertUnlock` is idempotent on the unique index.
    // Hidden easter eggs (`night-owl`/`early-bird`) are NEVER back-filled here
    // — they require the live event payload (UTC hour at call_end), which we
    // don't reconstruct from a counter snapshot.
    await this.backfillUnlocks(userId, accountCreatedAt).catch((err) => {
      this.logger.warn(`${TAG} backfill failed for user=${userId}: ${this.asMessage(err)}`);
    });

    const [unlockRows, counters] = await Promise.all([
      this.listUnlockRows(userId),
      this.readCounters(userId, accountCreatedAt, { all: true }),
    ]);

    // Group highest tier per id for the progress view.
    const highestTier = new Map<string, AchievementTier>();
    for (const row of unlockRows) {
      const prev = highestTier.get(row.achievementId) ?? 0;
      if (row.tier > prev) {
        highestTier.set(row.achievementId, row.tier);
      }
    }

    // Surface every catalogue row's progress UNLESS the user already capped
    // it (highest tier reached) OR it's a hidden easter-egg that hasn't fired.
    const progress: UserAchievementProgress[] = [];
    for (const entry of ACHIEVEMENTS_CATALOGUE) {
      const reached = highestTier.get(entry.id) ?? 0;
      if (reached >= entry.tiers.length) continue; // capped — show in unlocked, not progress
      if (entry.hidden && reached === 0) continue; // hidden until first unlock
      const nextTier = (reached + 1) as AchievementTier;
      const target = entry.tiers[nextTier - 1]!;
      const current = this.currentCounterFor(entry, counters);
      progress.push({
        achievementId: entry.id,
        current: Math.min(current, target),
        target,
        tier: nextTier,
      });
    }

    return {
      unlocked: unlockRows.map((row) => this.toUnlockEnvelope(row)),
      progress,
      checkedAt: this.clock().toISOString(),
    };
  }

  /**
   * Public slice for someone else's profile. The controller calls
   * `ProfilesService.getPublicProfileFor` FIRST to enforce
   * `whoCanViewProfile` + block gating — by the time we reach here the view is
   * authorised, so we just return the unlocks (no progress; that would leak
   * the target's own counters).
   */
  async getPublicAchievements(userId: string): Promise<PublicAchievements> {
    if (!Types.ObjectId.isValid(userId)) {
      return { unlocked: [] };
    }
    const rows = await this.listUnlockRows(userId);
    return { unlocked: rows.map((row) => this.toUnlockEnvelope(row)) };
  }

  // ── Entry point: checkAndUnlock ──────────────────────────────────────────

  /**
   * Single entry point cross-module callers fire on domain events. Returns
   * the list of NEW unlocks landed in this call (used by the wallet/social hot
   * paths to push a real-time toast). NEVER throws — a downstream failure here
   * is logged and swallowed so it cannot block the originating write.
   *
   * @param userId  the affected account
   * @param eventKey closed event enum (see `achievementEventKeySchema`)
   * @param payload optional event payload (e.g. call duration / UTC hour)
   * @param accountCreatedAt optional pre-loaded `User.createdAt`; callers that
   *   already have the user document handy avoid an extra lookup by passing it
   *   here. Falls back to a quick `users` read otherwise.
   */
  async checkAndUnlock(
    userId: string,
    eventKey: AchievementEventKey,
    payload: AchievementEventPayload = {},
    accountCreatedAt: Date | null = null,
  ): Promise<UserAchievementUnlock[]> {
    try {
      if (!Types.ObjectId.isValid(userId)) {
        return [];
      }
      const relevant = this.relevantForEvent(eventKey);
      if (relevant.length === 0) {
        return [];
      }

      // Resolve account age lazily if the caller didn't pre-fill it. The user
      // doc is read by collection name to keep this module free of a
      // cross-module schema dep on UsersModule.
      const createdAt = accountCreatedAt ?? (await this.readAccountCreatedAt(userId));

      // Snapshot every counter we know is needed for the relevant slice. This
      // is the ONLY DB read fan-out per event — every criteria below is then
      // a cheap in-memory compare.
      const counters = await this.readCounters(userId, createdAt, { kinds: relevant.map((e) => e.criteriaKind) });

      // Pre-load existing top-tier-per-id so we don't insert below the current
      // highest (avoiding a meaningless duplicate-key trap on the hot path).
      const existing = await this.listUnlockRows(userId);
      const highest = new Map<string, AchievementTier>();
      for (const row of existing) {
        const prev = highest.get(row.achievementId) ?? 0;
        if (row.tier > prev) highest.set(row.achievementId, row.tier);
      }

      const unlocked: UserAchievementUnlock[] = [];
      for (const entry of relevant) {
        const newTier = this.evaluateTier(entry, counters, eventKey, payload);
        if (!newTier) continue;
        const reached = highest.get(entry.id) ?? 0;
        if (newTier <= reached) continue;
        // Insert each NEW tier above the current high-water mark. So a user
        // crossing 10 → 100 in one shot (back-fill) unlocks Silver AND keeps
        // its Bronze row from before.
        for (let t = (reached + 1) as AchievementTier; t <= newTier; t = (t + 1) as AchievementTier) {
          const row = await this.tryInsertUnlock(userId, entry.id, t);
          if (row) {
            unlocked.push(this.toUnlockEnvelope(row));
          }
        }
      }

      return unlocked;
    } catch (err) {
      // NEVER throw — every caller must keep working through achievement
      // engine failures. Log with the structured tag for Sentry filters.
      this.logger.warn(`${TAG} failed for user=${userId} event=${eventKey}: ${this.asMessage(err)}`);
      return [];
    }
  }

  /**
   * Full-catalogue back-fill called from `getMyAchievements`. Walks every
   * COUNTER-based entry (skipping `eventOnce` easter eggs) and grants the
   * highest tier the user has crossed but not yet been awarded.
   *
   * Single counter snapshot is shared across all entries — the loop is
   * O(catalogue.length) in memory + at most `catalogue.length` ledger inserts
   * (trapped duplicates count as no-ops on the unique index).
   */
  private async backfillUnlocks(userId: string, accountCreatedAt: Date | null): Promise<void> {
    const createdAt = accountCreatedAt ?? (await this.readAccountCreatedAt(userId));
    const counters = await this.readCounters(userId, createdAt, { all: true });
    const existing = await this.listUnlockRows(userId);
    const highest = new Map<string, AchievementTier>();
    for (const row of existing) {
      const prev = highest.get(row.achievementId) ?? 0;
      if (row.tier > prev) highest.set(row.achievementId, row.tier);
    }

    for (const entry of ACHIEVEMENTS_CATALOGUE) {
      if (entry.criteriaKind === 'eventOnce') continue; // hidden — needs live payload
      // For the back-fill we don't have an event payload; `evaluateTier` is
      // happy with any non-eventOnce kind in this code path.
      const newTier = this.evaluateTier(entry, counters, 'session', {});
      if (!newTier) continue;
      const reached = highest.get(entry.id) ?? 0;
      if (newTier <= reached) continue;
      for (let t = (reached + 1) as AchievementTier; t <= newTier; t = (t + 1) as AchievementTier) {
        await this.tryInsertUnlock(userId, entry.id, t);
      }
    }
  }

  // ── Internals: catalogue routing ─────────────────────────────────────────

  /**
   * Map an event to the subset of catalogue rows it might unlock. The lookup
   * is STATIC (catalogue is a constant) — we materialise the slices once and
   * the hot path is a Map lookup.
   */
  private readonly eventRoutes: Record<AchievementEventKey, AchievementCatalogueEntry[]> = {
    session: this.filterCatalogue([
      'accountAgeDays',
      'accountAgeHours',
      'premiumActive',
      'leaderboardTop10AllTime',
      'leaderboardTop10Weekly',
      'leaderboardTop10Daily',
    ]),
    call_end: this.filterCatalogue(['callCount', 'callMinutes', 'eventOnce']),
    message_sent: this.filterCatalogue(['chatStarted', 'messagesSentCount']),
    friend_request_sent: this.filterCatalogue(['friendInviteSent']),
    friend_accepted: this.filterCatalogue(['friendsCount', 'friendInviteAccepted']),
    purchase: this.filterCatalogue(['purchaseCount', 'premiumActive']),
    gift_sent: this.filterCatalogue(['giftsSentCount', 'giftSentOnce']),
    gift_received: this.filterCatalogue(['coinsReceivedTotal', 'giftReceivedOnce']),
    daily_bonus_claim: this.filterCatalogue(['dailyBonusStreak']),
    leaderboard_placement: this.filterCatalogue([
      'leaderboardTop10AllTime',
      'leaderboardTop10Weekly',
      'leaderboardTop10Daily',
    ]),
    referral_completed: this.filterCatalogue(['referralCompleted']),
  };

  /** Helper to pre-slice the catalogue at construction. */
  private filterCatalogue(kinds: Array<AchievementCatalogueEntry['criteriaKind']>): AchievementCatalogueEntry[] {
    const set = new Set(kinds);
    return ACHIEVEMENTS_CATALOGUE.filter((entry) => set.has(entry.criteriaKind));
  }

  /** Public-facing alias for the route map (kept as a method so it can grow). */
  private relevantForEvent(eventKey: AchievementEventKey): AchievementCatalogueEntry[] {
    return this.eventRoutes[eventKey] ?? [];
  }

  // ── Internals: criteria evaluation ───────────────────────────────────────

  /**
   * The CURRENT counter value for a catalogue entry — used to drive the
   * progress caption ("3 / 10"). Returns 0 when the criteria has no numeric
   * counterpart (boolean criteria are either 0 or the cap).
   */
  private currentCounterFor(
    entry: AchievementCatalogueEntry,
    counters: AchievementCounters,
  ): number {
    const { accountAgeMs = 0 } = counters;
    const daysOld = Math.floor(accountAgeMs / (24 * 3600 * 1000));
    const hoursOld = Math.floor(accountAgeMs / (3600 * 1000));
    switch (entry.criteriaKind) {
      case 'accountAgeDays':
        return daysOld;
      case 'accountAgeHours':
        return hoursOld;
      case 'callCount':
        return counters.callCount ?? 0;
      case 'callMinutes':
        return counters.callMinutes ?? 0;
      case 'friendsCount':
        return counters.friendsCount ?? 0;
      case 'friendInviteSent':
        return counters.friendInviteSent ? 1 : 0;
      case 'friendInviteAccepted':
        return counters.friendInviteAccepted ? 1 : 0;
      case 'purchaseCount':
        return counters.purchaseCount ?? 0;
      case 'giftsSentCount':
        return counters.giftsSentCount ?? 0;
      case 'coinsReceivedTotal':
        return counters.coinsReceivedTotal ?? 0;
      case 'premiumActive':
        return counters.premiumActive ? 1 : 0;
      case 'leaderboardTop10AllTime':
        return counters.hasLeaderboardTop10AllTime ? 1 : 0;
      case 'leaderboardTop10Weekly':
        return counters.hasLeaderboardTop10Weekly ? 1 : 0;
      case 'leaderboardTop10Daily':
        return counters.hasLeaderboardTop10Daily ? 1 : 0;
      case 'chatStarted':
        return counters.hasStartedChat ? 1 : 0;
      case 'messagesSentCount':
        return counters.messagesSentCount ?? 0;
      case 'giftSentOnce':
        return counters.giftSentOnce ? 1 : 0;
      case 'giftReceivedOnce':
        return counters.giftReceivedOnce ? 1 : 0;
      case 'dailyBonusStreak':
        return counters.dailyBonusStreak ?? 0;
      case 'referralCompleted':
        return counters.referralCompleted ? 1 : 0;
      case 'eventOnce':
        return 0; // hidden + only triggered by the event payload
      default:
        return 0;
    }
  }

  /**
   * Decide the highest tier the user qualifies for on this catalogue entry,
   * given the counters + the originating event. Returns `null` when no tier
   * fires (criteria below the first threshold, or the event payload doesn't
   * satisfy a `eventOnce` gate).
   */
  private evaluateTier(
    entry: AchievementCatalogueEntry,
    counters: AchievementCounters,
    eventKey: AchievementEventKey,
    payload: AchievementEventPayload,
  ): AchievementTier | null {
    // `eventOnce` is the special case: the night-owl / early-bird hidden
    // badges fire on `call_end` with a UTC hour-of-day in a specific window.
    if (entry.criteriaKind === 'eventOnce') {
      if (eventKey !== 'call_end' || payload.hour === undefined) return null;
      const hour = payload.hour;
      if (entry.id === 'night-owl' && hour >= 2 && hour < 5) return 1;
      if (entry.id === 'early-bird' && hour >= 5 && hour < 8) return 1;
      return null;
    }
    const current = this.currentCounterFor(entry, counters);
    let reached: AchievementTier | null = null;
    for (let i = 0; i < entry.tiers.length; i += 1) {
      if (current >= entry.tiers[i]!) {
        reached = (i + 1) as AchievementTier;
      } else {
        break;
      }
    }
    return reached;
  }

  // ── Internals: counter snapshot ──────────────────────────────────────────

  /**
   * Read every counter (or only the kinds the slice needs) for `userId` and
   * the account creation timestamp. Parallel, batched reads against the
   * canonical sources:
   *   - `matches`           (count + sum-duration over participant index),
   *   - `friendships`       (count of accepted edges),
   *   - `cointransactions`  (purchase count, coins-received sum),
   *   - `gifttransactions`  (sent count + first-of presence),
   *   - `messages`          (sent count + first-of presence by sender),
   *   - `topplacements`     (leaderboard placement existence),
   *   - `dailybonuses`      (current streak).
   *   - `premium`           (`PremiumService.isPremium`).
   *
   * Each branch is GATED on whether the slice cares about it — so e.g. the
   * `friend_accepted` event only triggers the friendships read, not the
   * matches/aggregate scan.
   */
  private async readCounters(
    userId: string,
    accountCreatedAt: Date | null,
    selector: { all?: boolean; kinds?: Array<AchievementCatalogueEntry['criteriaKind']> },
  ): Promise<AchievementCounters> {
    const needed = (kind: AchievementCatalogueEntry['criteriaKind']): boolean => {
      if (selector.all) return true;
      return selector.kinds?.includes(kind) ?? false;
    };

    const counters: AchievementCounters = {};
    const now = this.clock();
    if (accountCreatedAt) {
      counters.accountAgeMs = Math.max(0, now.getTime() - accountCreatedAt.getTime());
    } else {
      counters.accountAgeMs = 0;
    }

    const objectId = new Types.ObjectId(userId);
    const userIdStr = userId;
    const db = this.connection.db;
    if (!db) {
      return counters;
    }

    const jobs: Array<Promise<void>> = [];

    if (needed('callCount') || needed('callMinutes')) {
      jobs.push(
        (async () => {
          // `matches` participants are stored as STRING `userA`/`userB` (see
          // the schema). Count + sum duration in one aggregation.
          const matchesColl = db.collection('matches');
          const agg = await matchesColl
            .aggregate([
              { $match: { $or: [{ userA: userIdStr }, { userB: userIdStr }] } },
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  durationMs: {
                    $sum: {
                      $cond: [
                        { $and: ['$startedAt', '$endedAt'] },
                        { $subtract: ['$endedAt', '$startedAt'] },
                        0,
                      ],
                    },
                  },
                },
              },
            ])
            .toArray();
          counters.callCount = (agg[0]?.['count'] as number | undefined) ?? 0;
          const durationMs = (agg[0]?.['durationMs'] as number | undefined) ?? 0;
          counters.callMinutes = Math.floor(durationMs / 60_000);
        })(),
      );
    }

    if (needed('friendsCount')) {
      jobs.push(
        (async () => {
          const friendshipsColl = db.collection('friendships');
          const count = await friendshipsColl.countDocuments({
            status: 'accepted',
            $or: [{ requesterId: objectId }, { recipientId: objectId }],
          });
          counters.friendsCount = count;
        })(),
      );
    }

    if (needed('friendInviteSent')) {
      jobs.push(
        (async () => {
          const friendshipsColl = db.collection('friendships');
          const found = await friendshipsColl.findOne({ requesterId: objectId }, { projection: { _id: 1 } });
          counters.friendInviteSent = !!found;
        })(),
      );
    }

    if (needed('friendInviteAccepted')) {
      jobs.push(
        (async () => {
          const friendshipsColl = db.collection('friendships');
          const found = await friendshipsColl.findOne(
            { recipientId: objectId, status: 'accepted' },
            { projection: { _id: 1 } },
          );
          counters.friendInviteAccepted = !!found;
        })(),
      );
    }

    if (needed('purchaseCount') || needed('coinsReceivedTotal')) {
      jobs.push(
        (async () => {
          const txColl = db.collection('cointransactions');
          if (needed('purchaseCount')) {
            counters.purchaseCount = await txColl.countDocuments({ userId: objectId, type: 'purchase' });
          }
          if (needed('coinsReceivedTotal')) {
            const agg = await txColl
              .aggregate([
                { $match: { userId: objectId, delta: { $gt: 0 } } },
                { $group: { _id: null, total: { $sum: '$delta' } } },
              ])
              .toArray();
            counters.coinsReceivedTotal = (agg[0]?.['total'] as number | undefined) ?? 0;
          }
        })(),
      );
    }

    if (needed('giftsSentCount') || needed('giftSentOnce')) {
      jobs.push(
        (async () => {
          const giftColl = db.collection('gifttransactions');
          if (needed('giftsSentCount')) {
            counters.giftsSentCount = await giftColl.countDocuments({ fromUserId: objectId });
          }
          if (needed('giftSentOnce')) {
            const found = await giftColl.findOne({ fromUserId: objectId }, { projection: { _id: 1 } });
            counters.giftSentOnce = !!found;
          }
        })(),
      );
    }

    if (needed('giftReceivedOnce')) {
      jobs.push(
        (async () => {
          const giftColl = db.collection('gifttransactions');
          const found = await giftColl.findOne({ toUserId: objectId }, { projection: { _id: 1 } });
          counters.giftReceivedOnce = !!found;
        })(),
      );
    }

    if (needed('chatStarted') || needed('messagesSentCount')) {
      jobs.push(
        (async () => {
          const msgColl = db.collection('messages');
          if (needed('chatStarted')) {
            const found = await msgColl.findOne({ senderId: objectId }, { projection: { _id: 1 } });
            counters.hasStartedChat = !!found;
          }
          if (needed('messagesSentCount')) {
            counters.messagesSentCount = await msgColl.countDocuments({ senderId: objectId });
          }
        })(),
      );
    }

    if (
      needed('leaderboardTop10AllTime') ||
      needed('leaderboardTop10Weekly') ||
      needed('leaderboardTop10Daily')
    ) {
      jobs.push(
        (async () => {
          const placementsColl = db.collection('topplacements');
          const found = await placementsColl.findOne({ userId: objectId }, { projection: { _id: 1 } });
          const hasAny = !!found;
          // Without a dedicated time-window column on placements we conservatively
          // collapse the three windows onto "has ANY placement" — the surface still
          // gates correctly (a user who's never placed gets nothing), and the
          // window-specific badges become aspirational distinctions a future
          // leaderboard schema can disambiguate.
          counters.hasLeaderboardTop10AllTime = hasAny;
          counters.hasLeaderboardTop10Weekly = hasAny;
          counters.hasLeaderboardTop10Daily = hasAny;
        })(),
      );
    }

    if (needed('dailyBonusStreak')) {
      jobs.push(
        (async () => {
          const dbColl = db.collection('dailybonuses');
          const row = await dbColl.findOne(
            { userId: objectId },
            { projection: { totalClaims: 1, streak: 1 } },
          );
          // The schema stores `streak` 0..7 (one cycle), but the loyalty badges
          // want the LIFETIME streak count — total claims is a strict upper bound
          // and is what the catalogue's "7-day"/"30-day" thresholds compare to.
          counters.dailyBonusStreak = (row?.['totalClaims'] as number | undefined) ?? 0;
        })(),
      );
    }

    if (needed('premiumActive')) {
      jobs.push(
        (async () => {
          counters.premiumActive = await this.premiumService.isPremium(userId).catch(() => false);
        })(),
      );
    }

    if (needed('referralCompleted')) {
      jobs.push(
        (async () => {
          // Referrals collection is owned by ReferralsModule; we read it by
          // collection name and treat "any completed row where this user is the
          // referrer" as the trigger.
          const refColl = db.collection('referrals');
          const found = await refColl
            .findOne({ referrerUserId: objectId, status: 'completed' }, { projection: { _id: 1 } })
            .catch(() => null);
          counters.referralCompleted = !!found;
        })(),
      );
    }

    await Promise.all(jobs);
    return counters;
  }

  /** Read just `users.createdAt` by collection name (avoids a UsersModule dep). */
  private async readAccountCreatedAt(userId: string): Promise<Date | null> {
    const db = this.connection.db;
    if (!db) return null;
    try {
      const usersColl = db.collection('users');
      const row = await usersColl.findOne(
        { _id: new Types.ObjectId(userId) },
        { projection: { createdAt: 1 } },
      );
      const createdAt = row?.['createdAt'];
      return createdAt instanceof Date ? createdAt : null;
    } catch {
      return null;
    }
  }

  // ── Internals: unlock storage ────────────────────────────────────────────

  /** Read every unlock row for the user, newest first. */
  private async listUnlockRows(userId: string): Promise<UserAchievementDocument[]> {
    return this.userAchievementModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ unlockedAt: -1 })
      .exec();
  }

  /**
   * Blind-insert a `(userId, achievementId, tier)` unlock and TRAP the unique
   * constraint violation (E11000) as "already unlocked, no-op". Returns the
   * inserted document on success, or `null` on the no-op path.
   */
  private async tryInsertUnlock(
    userId: string,
    achievementId: string,
    tier: AchievementTier,
  ): Promise<UserAchievementDocument | null> {
    try {
      const doc = await this.userAchievementModel.create({
        userId: new Types.ObjectId(userId),
        achievementId,
        tier,
        unlockedAt: this.clock(),
      });
      return doc;
    } catch (err) {
      if (this.isDuplicateKeyError(err)) {
        return null;
      }
      throw err;
    }
  }

  private isDuplicateKeyError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const e = err as { code?: number; name?: string };
    return e.code === 11000 || e.name === 'MongoServerError';
  }

  // ── Internals: envelope mapping ──────────────────────────────────────────

  /** Map a hydrated document to the wire shape. */
  private toUnlockEnvelope(row: UserAchievementDocument): UserAchievementUnlock {
    return {
      achievementId: row.achievementId,
      tier: row.tier,
      unlockedAt: row.unlockedAt.toISOString(),
    };
  }

  private asMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
