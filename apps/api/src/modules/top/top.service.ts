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

    // ONE batched profile lookup for every promoted user across both lanes.
    const profiles = await this.loadPromotedProfiles([...left, ...right]);
    const withProfile = (p: TopPlacementContract): TopPlacementContract => ({
      ...p,
      profile: profiles.get(p.userId) ?? null,
    });

    return { left: left.map(withProfile), right: right.map(withProfile) };
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
   * Purchase a placement in `dto.lane` for `dto.durationHours`, spending
   * `dto.coins`.
   *
   * Order of operations (auditable + safe):
   *  1. enforce the minimum placement spend ({@link MIN_TOP_PLACEMENT_COINS}) —
   *     `400` before charging;
   *  2. atomically DEBIT the buyer (`top`) — throws 422 on low balance — using
   *     the pre-allocated placement id as the ledger `refId`;
   *  3. create the {@link TopPlacement} (active from now for `durationHours`).
   *     On a write failure after a successful debit, the coins are refunded.
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
      const expiresAt = new Date(startsAt.getTime() + dto.durationHours * HOUR_MS);
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
