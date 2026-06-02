import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type {
  TopLane,
  TopPlacement as TopPlacementContract,
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
    private readonly walletService: WalletService,
  ) {}

  /**
   * Currently-active placements grouped by lane, each ordered by `priority`
   * descending (then newest first as a tiebreak).
   */
  async getActiveFeed(): Promise<TopFeed> {
    const now = new Date();
    const [left, right] = await Promise.all([
      this.activeForLane('left', now),
      this.activeForLane('right', now),
    ]);
    return { left, right };
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
