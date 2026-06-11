import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Job, Queue } from 'bullmq';
import { Model, Types } from 'mongoose';

import { MetricsService } from '../../observability/metrics.service';
import { registerSweepWithRetry, sweepJobOptions } from '../../observability/sweep-job';
import {
  CoinTransaction,
  CoinTransactionDocument,
} from '../wallet/schemas/coin-transaction.schema';
import { ReferralCursor, ReferralCursorDocument } from './schemas/referral-cursor.schema';
import { ReferralsService } from './referrals.service';

/** BullMQ queue name for the referral reward fan-out sweep. */
export const REFERRAL_REWARD_QUEUE = 'referral-reward-sweep';

/** Stable job name + id (the id de-dupes the repeatable schedule across boots). */
const SWEEP_JOB_NAME = 'fan-out-purchase-rewards';

/**
 * How often the sweep runs. Once a minute is plenty: the wallet has already
 * credited the buyer, and the inviter sees referral coins land within ≤60s.
 * Frequent enough that a referred user's first purchase reflects on the
 * inviter's dashboard during the same browsing session.
 */
const SWEEP_EVERY_MS = 60 * 1000;

/** How many ledger rows we process per sweep pass — bounded for safety. */
const BATCH_LIMIT = 200;

/**
 * Repeatable BullMQ sweep that fans out 3-tier referral rewards from new
 * `purchase` ledger rows.
 *
 * ── Why a sweep rather than a direct call site ─────────────────────────────
 * The brief is explicit: this module must not touch the wallet / payments /
 * auth core logic. Hooking into `WalletService.credit` or `PaymentsService.
 * fulfilCoins` directly would violate that. Instead we treat the immutable
 * `cointransactions` ledger as the event log:
 *
 *   1. Persist a tiny per-app cursor row pointing at the LATEST processed
 *      ledger `_id` (one document — `ReferralCursor`).
 *   2. Each sweep pass reads up to {@link BATCH_LIMIT} ledger rows of
 *      `type: 'purchase'` with `_id > cursor`, sorted ascending by `_id`.
 *   3. For each row we call {@link ReferralsService.creditPurchaseRewards}
 *      which is idempotent (wallet `(type, refId)` index), so a sweep that
 *      retries the same ledger row never double-credits.
 *   4. Advance the cursor to the highest `_id` we processed in this pass.
 *
 * ── Idempotency safety ─────────────────────────────────────────────────────
 * The CURSOR is a denormalised optimisation, NOT the source of truth. Even if
 * the cursor row vanished and the sweep replayed the entire ledger, the
 * wallet's partial-unique `(type, refId)` index would still make every reward
 * credit AT-MOST-ONCE.
 */
@Processor(REFERRAL_REWARD_QUEUE)
export class ReferralRewardProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ReferralRewardProcessor.name);

  constructor(
    @InjectQueue(REFERRAL_REWARD_QUEUE) private readonly queue: Queue,
    @InjectModel(CoinTransaction.name)
    private readonly coinTxModel: Model<CoinTransactionDocument>,
    @InjectModel(ReferralCursor.name)
    private readonly cursorModel: Model<ReferralCursorDocument>,
    private readonly referralsService: ReferralsService,
    private readonly metrics: MetricsService,
  ) {
    super();
  }

  /**
   * Register the repeatable sweep job once the queue is available. Bounded
   * retry + loud surfacing of a Redis blip live in `registerSweepWithRetry` —
   * a scheduler hiccup degrades (logs + metric) rather than crashing the API.
   */
  async onModuleInit(): Promise<void> {
    await registerSweepWithRetry({
      queue: this.queue,
      queueName: REFERRAL_REWARD_QUEUE,
      jobName: SWEEP_JOB_NAME,
      jobOptions: sweepJobOptions(SWEEP_EVERY_MS, SWEEP_JOB_NAME),
      metrics: this.metrics,
      logger: this.logger,
      successMessage: `Registered repeatable referral reward sweep (every ${SWEEP_EVERY_MS / 1000}s)`,
    });
  }

  /** Execute one sweep pass. */
  async process(_job: Job): Promise<{ processed: number; rewardsCredited: number }> {
    // Load the per-app cursor (lazily upserted on first pass — the cursor row
    // is keyed by a fixed `_id` so a redelivery against a freshly-restarted
    // app never doubles up).
    const cursorRow = await this.cursorModel
      .findOneAndUpdate(
        { key: ReferralCursor.SINGLETON_KEY },
        { $setOnInsert: { key: ReferralCursor.SINGLETON_KEY, lastLedgerId: null } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();

    const filter: Record<string, unknown> = {
      type: 'purchase',
      delta: { $gt: 0 },
    };
    if (cursorRow.lastLedgerId) {
      filter._id = { $gt: cursorRow.lastLedgerId };
    }

    const rows = await this.coinTxModel
      .find(filter)
      .select('userId delta')
      .sort({ _id: 1 })
      .limit(BATCH_LIMIT)
      .lean()
      .exec();

    if (rows.length === 0) {
      return { processed: 0, rewardsCredited: 0 };
    }

    let rewardsCredited = 0;
    let highWatermark: Types.ObjectId | null = cursorRow.lastLedgerId;
    for (const row of rows) {
      try {
        const result = await this.referralsService.creditPurchaseRewards(
          row.userId.toString(),
          row.delta,
          row._id.toString(),
        );
        rewardsCredited += result.credited.length;
        highWatermark = row._id;
      } catch (err) {
        // Idempotent-safe: leave the cursor at the LAST successful row and let
        // the next sweep retry from this one. We do NOT advance past a failure.
        this.logger.error(
          `Referral reward fan-out for ledger ${row._id.toString()} failed; ` +
            `cursor stays at ${highWatermark?.toString() ?? 'genesis'}: ${(err as Error).message}`,
        );
        break;
      }
    }

    if (highWatermark && (!cursorRow.lastLedgerId || highWatermark.toString() !== cursorRow.lastLedgerId.toString())) {
      await this.cursorModel
        .updateOne(
          { key: ReferralCursor.SINGLETON_KEY },
          { $set: { lastLedgerId: highWatermark } },
        )
        .exec();
    }

    return { processed: rows.length, rewardsCredited };
  }

  @OnWorkerEvent('completed')
  onCompleted(): void {
    this.metrics.queueJobCompleted(REFERRAL_REWARD_QUEUE);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    this.metrics.queueJobFailed(REFERRAL_REWARD_QUEUE);
    this.logger.error(
      `Referral reward sweep job ${job?.name ?? SWEEP_JOB_NAME} ${job?.id ?? '(none)'} failed: ${err.message}`,
    );
  }
}
