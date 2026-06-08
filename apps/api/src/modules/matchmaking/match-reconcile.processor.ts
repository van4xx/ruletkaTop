import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';

import { MetricsService } from '../../observability/metrics.service';
import { registerSweepWithRetry, sweepJobOptions } from '../../observability/sweep-job';
import { MatchService } from './match.service';

/** BullMQ queue name for the stale-match reconciliation sweep. */
export const MATCH_RECONCILE_QUEUE = 'match-reconcile';

/** The single repeatable job's name + id (a stable id de-dupes the scheduler). */
const SWEEP_JOB_NAME = 'close-stale-active';

/**
 * How often the sweep runs. Stale rows are bounded by the room TTL ceiling, so
 * an hourly pass closes them well within a reasonable analytics window without
 * churn.
 */
const SWEEP_EVERY_MS = 60 * 60 * 1000;

/**
 * Background worker that periodically force-closes `active` {@link Match} rows
 * left open by an unclean teardown (crashed gateway, lost final signal, hard
 * process kill). Mirrors the subscription expiry sweep
 * ({@link SubscriptionSweepProcessor}) one-for-one.
 *
 * ── Why a sweep ──────────────────────────────────────────────────────────────
 * {@link MatchService.endMatch} closes a match on the normal hangup/disconnect
 * paths, but those can be skipped if a node dies mid-call. The orphaned row then
 * sits `endedAt: null` forever, polluting "live session" counts and duration
 * analytics. {@link MatchService.reconcileStale} stamps such rows
 * `endedAt`/`endReason='timeout'` once they are provably abandoned (older than
 * the room-TTL ceiling) — idempotent and safe to re-run.
 *
 * ── Registration ─────────────────────────────────────────────────────────────
 * On boot we (re)register ONE repeatable job with a stable job id, so multiple
 * API instances and repeated restarts converge on a single schedule rather than
 * stacking duplicate timers. The BullMQ root connection is configured in
 * {@link AppModule}; this only needs the queue (via `BullModule.registerQueue`
 * in {@link MatchmakingModule}).
 */
@Processor(MATCH_RECONCILE_QUEUE)
export class MatchReconcileProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(MatchReconcileProcessor.name);

  constructor(
    @InjectQueue(MATCH_RECONCILE_QUEUE) private readonly queue: Queue,
    private readonly matchService: MatchService,
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
      queueName: MATCH_RECONCILE_QUEUE,
      jobName: SWEEP_JOB_NAME,
      jobOptions: sweepJobOptions(SWEEP_EVERY_MS, SWEEP_JOB_NAME),
      metrics: this.metrics,
      logger: this.logger,
      successMessage: `Registered repeatable match reconciliation sweep (every ${SWEEP_EVERY_MS / 60000}m)`,
    });
  }

  /** Execute one sweep pass. */
  async process(_job: Job): Promise<{ reconciled: number }> {
    const reconciled = await this.matchService.reconcileStale();
    return { reconciled };
  }

  /** A sweep invocation ran to success — record it for completeness/alerting. */
  @OnWorkerEvent('completed')
  onCompleted(): void {
    this.metrics.queueJobCompleted(MATCH_RECONCILE_QUEUE);
  }

  /**
   * A sweep invocation errored. Log at error level with job name+id+reason and
   * bump `ruletka_queue_jobs_failed_total{queue}` so it is alertable. The failed
   * job is retained (bounded) in BullMQ's failed set for inspection.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    this.metrics.queueJobFailed(MATCH_RECONCILE_QUEUE);
    this.logger.error(
      `Match reconciliation job ${job?.name ?? SWEEP_JOB_NAME} ${job?.id ?? '(none)'} failed: ${err.message}`,
    );
  }
}
