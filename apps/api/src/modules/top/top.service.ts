import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import type {
  TopLane,
  TopPlacement as TopPlacementContract,
  TopPlacementProfile,
  TopPurchaseDto,
} from '@ruletka/shared-types';

import { WalletService } from '../wallet/wallet.service';
import { TopPlacement, TopPlacementDocument } from './schemas/top-placement.schema';

/** Milliseconds in one hour (for `expiresAt` computation). */
const HOUR_MS = 60 * 60 * 1000;

/**
 * Minimum coins required for a single top placement. The shared DTO only
 * requires a positive integer, which would let a 1-coin placement clutter the
 * feed; this service-level floor keeps a placement meaningful (and is enforced
 * server-side regardless of client). Kept here — NOT in shared-types — so it can
 * be tuned without a contract change.
 */
export const MIN_TOP_PLACEMENT_COINS = 50;

/**
 * SERVER-SIDE coins→duration tier table. The shared DTO bounds `durationHours`
 * to 1..720 but does NOT tie the window to spend, so a client could request the
 * full 720-hour (30-day) window for the 50-coin floor. We therefore DERIVE the
 * active window from coins spent here and ignore the client-supplied duration:
 * a placement's lifetime is bought, not declared. `priority` still equals coins,
 * so spend continues to drive in-lane ranking independently of the window.
 *
 * Each tier is the inclusive minimum coins that unlocks its `hours`; the longest
 * tier whose `minCoins` the spend meets wins. Ordered HIGHEST-first so the
 * resolver returns the first match. The cap (720h, the DTO ceiling) requires the
 * top tier — the 50-coin floor can only ever buy the shortest window.
 */
export const TOP_DURATION_TIERS: ReadonlyArray<{ minCoins: number; hours: number }> = [
  { minCoins: 1000, hours: 720 }, // 30 days — the DTO ceiling, top spend only
  { minCoins: 500, hours: 168 }, // 7 days
  { minCoins: 200, hours: 72 }, // 3 days
  { minCoins: MIN_TOP_PLACEMENT_COINS, hours: 24 }, // 1 day — the floor tier
];

/**
 * Resolve the active-window hours a given spend buys from {@link TOP_DURATION_TIERS}.
 * Returns the highest tier whose `minCoins` `coins` meets. Callers must already
 * have enforced the {@link MIN_TOP_PLACEMENT_COINS} floor, so a match always
 * exists; the floor tier is the defensive fallback.
 */
export function durationHoursForCoins(coins: number): number {
  for (const tier of TOP_DURATION_TIERS) {
    if (coins >= tier.minCoins) {
      return tier.hours;
    }
  }
  // Unreachable once the floor is enforced; fall back to the shortest window.
  return TOP_DURATION_TIERS[TOP_DURATION_TIERS.length - 1]!.hours;
}

/** The two top-feed lanes of currently-active placements. */
export interface TopFeed {
  left: TopPlacementContract[];
  right: TopPlacementContract[];
}

/**
 * Read model for the "top" feed and the placement-purchase flow.
 *
 * Buying a placement atomically DEBITS the buyer's wallet (via the exported
 * {@link WalletService}, ledger type `top`) and records a {@link TopPlacement}
 * active for `durationHours`. `priority` is derived from coins spent so bigger
 * spenders rank higher within a lane.
 */
@Injectable()
export class TopService {
  private readonly logger = new Logger(TopService.name);

  constructor(
    @InjectModel(TopPlacement.name)
    private readonly placementModel: Model<TopPlacementDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly walletService: WalletService,
  ) {}

  /**
   * Currently-active placements grouped by lane, each ordered by `priority`
   * descending (then newest first as a tiebreak), with the promoted user's
   * display profile DENORMALISED onto every entry.
   *
   * The profile join is a SINGLE batched `$in` over the `profiles` collection
   * for ALL promoted users across both lanes (not one `GET /profiles/:id` per
   * card) — this is what kills the previous client-side N+1: the feed now
   * arrives card-ready in one round-trip. Profiles are read by collection name
   * via the shared connection (the same approach friends/chat/leaderboard use)
   * so the top module takes no hard dependency on ProfilesModule.
   */
  async getActiveFeed(): Promise<TopFeed> {
    const now = new Date();
    const [left, right] = await Promise.all([
      this.activeForLane('left', now),
      this.activeForLane('right', now),
    ]);

    // Defence-in-depth: resolve which promoted owners are TORN-DOWN
    // (`deletedAt`) or BANNED so their paid placement never shows even if the
    // write-time expiry teardown missed it. One $in over the `users` source.
    const dead = await this.deadUserIds([...left, ...right].map((p) => p.userId));

    // ONE batched profile lookup for every promoted user across both lanes.
    const profiles = await this.loadPromotedProfiles([...left, ...right]);

    // A card is shown only when its owner is LIVE and their public profile still
    // resolves — a placement whose profile is gone (deleted/scrubbed) is dropped
    // entirely rather than shown as an empty `profile: null` card.
    const presentable = (p: TopPlacementContract): TopPlacementContract | null => {
      if (dead.has(p.userId)) {
        return null;
      }
      const profile = profiles.get(p.userId);
      if (!profile) {
        return null;
      }
      return { ...p, profile };
    };
    const keep = (lane: TopPlacementContract[]): TopPlacementContract[] =>
      lane.map(presentable).filter((p): p is TopPlacementContract => p !== null);

    return { left: keep(left), right: keep(right) };
  }

  /**
   * Resolve, in ONE `$in` query against the `users` source-of-truth, which of
   * the given promoted owners belong to a TORN-DOWN (`deletedAt != null`) or
   * BANNED (`isBanned === true`) account — those placements must never show.
   * Returns a set of the offending userId strings (empty when all are live).
   */
  private async deadUserIds(userIds: readonly string[]): Promise<Set<string>> {
    const dead = new Set<string>();
    const objectIds = Array.from(new Set(userIds))
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

  /**
   * Batch-load the minimal display profile for a set of placements in ONE `$in`
   * query against the `profiles` collection, keyed by `userId` (string). Mirrors
   * `FriendsService.loadMinimalProfiles`. Duplicate promoted users (the same
   * person in both lanes) cost a single row. A promoted user whose profile no
   * longer resolves is simply absent from the map (the entry gets `profile:
   * null`).
   */
  private async loadPromotedProfiles(
    placements: readonly TopPlacementContract[],
  ): Promise<Map<string, TopPlacementProfile>> {
    const out = new Map<string, TopPlacementProfile>();
    if (placements.length === 0) {
      return out;
    }
    const objectIds = Array.from(new Set(placements.map((p) => p.userId)))
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (objectIds.length === 0) {
      return out;
    }

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
        id: p.userId.toString(),
        nickname: p.nickname ?? '',
        avatarUrl: p.avatarUrl ?? null,
        isPremium: p.isPremium ?? false,
      });
    }
    return out;
  }

  /**
   * Purchase a placement in `dto.lane`, spending `dto.coins`.
   *
   * The active-window length is DERIVED from the spend via
   * {@link durationHoursForCoins} ({@link TOP_DURATION_TIERS}) — the client's
   * `dto.durationHours` is NOT trusted, so the {@link MIN_TOP_PLACEMENT_COINS}
   * floor can never buy the full 720-hour window. `priority` still equals coins
   * so spend drives in-lane ranking independently of the window.
   *
   * Order of operations (auditable + safe):
   *  1. enforce the minimum placement spend ({@link MIN_TOP_PLACEMENT_COINS}) —
   *     `400` before charging;
   *  2. atomically DEBIT the buyer (`top`) — throws 422 on low balance — using
   *     the pre-allocated placement id as the ledger `refId`;
   *  3. create the {@link TopPlacement} (active from now for the spend-derived
   *     duration). On a write failure after a successful debit, the coins are
   *     refunded.
   *
   * @returns the created placement in the shared contract shape.
   */
  async purchase(userId: string, dto: TopPurchaseDto): Promise<TopPlacementContract> {
    if (dto.coins < MIN_TOP_PLACEMENT_COINS) {
      throw new BadRequestException(
        `A top placement requires at least ${MIN_TOP_PLACEMENT_COINS} coins`,
      );
    }

    const placementId = new Types.ObjectId();

    // Step 2: charge first. Throws InsufficientFundsException (422) on shortfall.
    await this.walletService.debit(userId, dto.coins, 'top', placementId.toString());

    // Step 2: create the placement; compensate on failure.
    try {
      const startsAt = new Date();
      // The window is DERIVED from spend server-side (see TOP_DURATION_TIERS),
      // NOT taken from the client-supplied `dto.durationHours` — otherwise the
      // 50-coin floor could buy the full 720-hour window. The client value is
      // accepted by the DTO but never authoritative for the lifetime.
      const durationHours = durationHoursForCoins(dto.coins);
      const expiresAt = new Date(startsAt.getTime() + durationHours * HOUR_MS);
      const docs = await this.placementModel.create([
        {
          _id: placementId,
          userId: new Types.ObjectId(userId),
          lane: dto.lane,
          // Spend drives ranking: more coins ⇒ higher priority within the lane.
          priority: dto.coins,
          coinsSpent: dto.coins,
          startsAt,
          expiresAt,
        },
      ]);
      const created = docs[0];
      if (!created) {
        throw new Error('Top placement creation returned no document');
      }
      return this.toContract(created);
    } catch (err) {
      await this.walletService
        .credit(userId, dto.coins, 'refund', placementId.toString())
        .catch((refundErr: unknown) =>
          this.logger.error(
            `Failed to refund ${dto.coins} coins to ${userId} after top-placement ` +
              `write failure: ${(refundErr as Error).message}`,
          ),
        );
      throw err;
    }
  }

  /**
   * EXPIRY SWEEP (called by the repeatable BullMQ job): reconcile every
   * placement whose active window has elapsed but which the sweep has not yet
   * latched, flipping {@link TopPlacement.expired} to `true`.
   *
   * Live correctness does NOT depend on this — {@link activeForLane} already
   * filters the feed by `expiresAt > now`, so a lapsed placement stops showing
   * the instant its window closes regardless of the flag. The sweep exists so
   * the collection cannot grow an unbounded backlog of unmarked dead rows: it
   * gives every expired placement an explicit terminal state (for audit /
   * metrics) and a latch so a second pass never re-touches it.
   *
   * Idempotent + safe on any cadence: the filter only matches rows that are
   * past `expiresAt` AND not yet `expired`, so re-running is a no-op once caught
   * up. Returns the number of placements reconciled (for logging/metrics).
   */
  async sweepExpired(now: Date = new Date()): Promise<number> {
    const res = await this.placementModel
      .updateMany(
        { expired: { $ne: true }, expiresAt: { $lte: now } },
        { $set: { expired: true } },
      )
      .exec();

    const reconciled = res.modifiedCount ?? 0;
    if (reconciled > 0) {
      this.logger.log(`Top expiry sweep: reconciled ${reconciled} placement(s)`);
    }
    return reconciled;
  }

  /** Active placements for one lane, highest priority first. */
  private async activeForLane(lane: TopLane, now: Date): Promise<TopPlacementContract[]> {
    const docs = await this.placementModel
      .find({ lane, startsAt: { $lte: now }, expiresAt: { $gt: now } })
      .sort({ priority: -1, createdAt: -1 })
      .exec();
    return docs.map((doc) => this.toContract(doc));
  }

  /** Map a hydrated placement document to the shared contract shape. */
  private toContract(doc: TopPlacementDocument): TopPlacementContract {
    return {
      id: doc._id.toString(),
      userId: doc.userId.toString(),
      lane: doc.lane,
      priority: doc.priority,
      coinsSpent: doc.coinsSpent,
      startsAt: doc.startsAt.toISOString(),
      expiresAt: doc.expiresAt.toISOString(),
    };
  }
}
