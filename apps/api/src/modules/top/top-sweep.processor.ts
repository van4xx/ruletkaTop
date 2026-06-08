import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';

import { MetricsService } from '../../observability/metrics.service';
import { registerSweepWithRetry, sweepJobOptions } from '../../observability/sweep-job';
import { TopService } from './top.service';

/** BullMQ queue name for the top-placement expiry sweep. */
export const TOP_SWEEP_QUEUE = 'top-sweep';

/** The single repeatable job's name + id (a stable id de-dupes the scheduler). */
const SWEEP_JOB_NAME = 'expire-placements';

/**
 * How often the sweep runs. Placements are typically bought for hours, so a
 * 10-minute cadence keeps the reconciliation backlog tiny without churn. (Feed
 * freshness does NOT depend on this — see {@link TopService.sweepExpired}.)
 */
const SWEEP_EVERY_MS = 10 * 60 * 1000;

/**
 * Background worker that periodically reconciles expired top placements so the
 * `topplacements` collection cannot accumulate an unbounded backlog of unmarked
 * dead rows. Mirrors the subscription expiry sweep
 * ({@link SubscriptionSweepProcessor}) one-for-one.
 *
 * ── Why a sweep ──────────────────────────────────────────────────────────────
 * The Top feed already shows only LIVE placements (it filters by
 * `expiresAt > now`), so an expired placement disappears the moment its window
 * closes. But nothing would ever give those rows a terminal marker, leaving the
 * collection to grow without bound. {@link TopService.sweepExpired} flips an
 * `expired` latch on past-window rows — idempotent and safe to re-run.
 *
 * ── Registration ─────────────────────────────────────────────────────────────
 * On boot we (re)register ONE repeatable job with a stable job id, so multiple
 * API instances and repeated restarts converge on a single schedule rather than
 * stacking duplicate timers. The BullMQ root connection is configured in
 * {@link AppModule}; this only needs the queue (via `BullModule.registerQueue`
 * in {@link TopModule}).
 */
@Processor(TOP_SWEEP_QUEUE)
export class TopSweepProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(TopSweepProcessor.name);

  constructor(
    @InjectQueue(TOP_SWEEP_QUEUE) private readonly queue: Queue,
    private readonly topService: TopService,
    private readonly metrics: MetricsService,
  ) {
    super();
  }

  /**
   * Register the repeatable sweep job once the queue is available. Bounded
   * retry + loud surfacing of a Redis blip live in {@link registerSweepWithRetry}
   * — a scheduler hiccup degrades (logs + metric) rather than crashing the API.
   */
  async onModuleInit(): Promise<void> {
    await registerSweepWithRetry({
      queue: this.queue,
      queueName: TOP_SWEEP_QUEUE,
      jobName: SWEEP_JOB_NAME,
      jobOptions: sweepJobOptions(SWEEP_EVERY_MS, SWEEP_JOB_NAME),
      metrics: this.metrics,
      logger: this.logger,
      successMessage: `Registered repeatable top expiry sweep (every ${SWEEP_EVERY_MS / 60000}m)`,
    });
  }

  /** Execute one sweep pass. */
  async process(_job: Job): Promise<{ reconciled: number }> {
    const reconciled = await this.topService.sweepExpired();
    return { reconciled };
  }

  /** A sweep invocation ran to success — record it for completeness/alerting. */
  @OnWorkerEvent('completed')
  onCompleted(): void {
    this.metrics.queueJobCompleted(TOP_SWEEP_QUEUE);
  }

  /**
   * A sweep invocation errored. Log at error level with job name+id+reason and
   * bump `ruletka_queue_jobs_failed_total{queue}` so it is alertable. The failed
   * job is retained (bounded) in BullMQ's failed set for inspection.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    this.metrics.queueJobFailed(TOP_SWEEP_QUEUE);
    this.logger.error(
      `Top sweep job ${job?.name ?? SWEEP_JOB_NAME} ${job?.id ?? '(none)'} failed: ${err.message}`,
    );
  }
}
