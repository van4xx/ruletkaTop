import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';

import { MetricsService } from '../../observability/metrics.service';
import { registerSweepWithRetry, sweepJobOptions } from '../../observability/sweep-job';
import { PremiumService } from './premium.service';

/** BullMQ queue name for the subscription expiry sweep. */
export const SUBSCRIPTION_SWEEP_QUEUE = 'subscription-sweep';

/** The single repeatable job's name + id (a stable id de-dupes the scheduler). */
const SWEEP_JOB_NAME = 'expire-lapsed';

/** How often the sweep runs. Hourly is ample for day-granularity expiry. */
const SWEEP_EVERY_MS = 60 * 60 * 1000;

/**
 * Background worker that periodically expires lapsed / cancelled-and-elapsed
 * subscriptions so entitlement never outlives the paid period — the
 * authoritative counterpart to the (eventually-consistent) profile mirror.
 *
 * ── Why a sweep ──────────────────────────────────────────────────────────────
 * Entitlement is computed as `status === 'active' && currentPeriodEnd > now`, so
 * a lapsed subscription is already correctly treated as non-premium at read
 * time. But the stored `status` and the `profiles.isPremium` mirror would stay
 * stale forever without an active transition. This sweep performs that
 * transition (→ `none`, badge pulled) on a schedule via
 * {@link PremiumService.sweepExpired}, which is idempotent and safe to re-run.
 *
 * ── Registration ─────────────────────────────────────────────────────────────
 * On boot we (re)register ONE repeatable job with a stable job id, so multiple
 * API instances and repeated restarts converge on a single schedule rather than
 * stacking duplicate timers. The actual BullMQ root connection is configured in
 * {@link AppModule}; this only needs the queue (via `BullModule.registerQueue`
 * in {@link PremiumModule}).
 */
@Processor(SUBSCRIPTION_SWEEP_QUEUE)
export class SubscriptionSweepProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionSweepProcessor.name);

  constructor(
    @InjectQueue(SUBSCRIPTION_SWEEP_QUEUE) private readonly queue: Queue,
    private readonly premiumService: PremiumService,
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
      queueName: SUBSCRIPTION_SWEEP_QUEUE,
      jobName: SWEEP_JOB_NAME,
      jobOptions: sweepJobOptions(SWEEP_EVERY_MS, SWEEP_JOB_NAME),
      metrics: this.metrics,
      logger: this.logger,
      successMessage: `Registered repeatable subscription expiry sweep (every ${SWEEP_EVERY_MS / 60000}m)`,
    });
  }

  /** Execute one sweep pass. */
  async process(_job: Job): Promise<{ expired: number }> {
    const expired = await this.premiumService.sweepExpired();
    return { expired };
  }

  /** A sweep invocation ran to success — record it for completeness/alerting. */
  @OnWorkerEvent('completed')
  onCompleted(): void {
    this.metrics.queueJobCompleted(SUBSCRIPTION_SWEEP_QUEUE);
  }

  /**
   * A sweep invocation errored. Log at error level with job name+id+reason and
   * bump `ruletka_queue_jobs_failed_total{queue}` so it is alertable. The failed
   * job is retained (bounded) in BullMQ's failed set for inspection.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    this.metrics.queueJobFailed(SUBSCRIPTION_SWEEP_QUEUE);
    this.logger.error(
      `Subscription sweep job ${job?.name ?? SWEEP_JOB_NAME} ${job?.id ?? '(none)'} failed: ${err.message}`,
    );
  }
}
