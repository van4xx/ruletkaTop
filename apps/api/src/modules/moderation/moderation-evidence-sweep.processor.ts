import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { MetricsService } from '../../observability/metrics.service';
import { registerSweepWithRetry, sweepJobOptions } from '../../observability/sweep-job';
import { ReportsService } from './reports.service';
import { ReviewService } from './review.service';

/** BullMQ queue name for the abuse-evidence retention sweep. */
export const MODERATION_EVIDENCE_SWEEP_QUEUE = 'moderation-evidence-sweep';

/** The single repeatable job's name + id (a stable id de-dupes the scheduler). */
const SWEEP_JOB_NAME = 'purge-expired-evidence';

/**
 * How often the sweep runs. Daily is ample — evidence retention is bounded in
 * days/months (see the retention floor/ceiling constants), so day-granularity
 * purging is more than precise enough and keeps DB churn negligible.
 */
const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * Background worker that periodically PURGES captured abuse-evidence blobs whose
 * retention has expired — the 152-ФЗ / GDPR data-minimisation counterpart to the
 * (previously unbounded) `reports.evidenceUrl` / `moderation_events.evidenceUrl`
 * storage.
 *
 * ── Why a sweep ──────────────────────────────────────────────────────────────
 * Evidence frames are captured at report/flag time and retained for moderator
 * review, but holding a person's captured image FOREVER violates
 * data-minimisation. A plain TTL index can't express the policy we need
 * (purge only once a case is terminal AND a statutory floor has elapsed, with a
 * hard ceiling backstop), so we sweep instead — exactly mirroring the
 * subscription / top expiry sweeps. Both purge methods are idempotent (they
 * only match rows that still HAVE an `evidenceUrl`), so the job is safe to retry
 * and re-run. The row itself (label/score/action/status) is RETAINED for audit;
 * only the blob is nulled.
 *
 * ── CSAM escalation (TODO) ───────────────────────────────────────────────────
 * For `minor` (CSAM-risk) evidence the law-enforcement referral workflow is a
 * SEPARATE product task — see the note on `EVIDENCE_RETENTION_CEILING_MS` in
 * `moderation.constants.ts`. A real deployment MUST wire a pre-purge escalation
 * hook (preserve + refer `minor`-label evidence) before this runs in production.
 *
 * ── Registration ─────────────────────────────────────────────────────────────
 * On boot we (re)register ONE repeatable job with a stable job id so multiple
 * API instances and restarts converge on a single schedule. Bounded retry +
 * loud surfacing of a Redis blip live in {@link registerSweepWithRetry}; a
 * scheduler hiccup degrades (logs + metric) rather than crashing the API.
 */
@Processor(MODERATION_EVIDENCE_SWEEP_QUEUE)
export class ModerationEvidenceSweepProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ModerationEvidenceSweepProcessor.name);

  constructor(
    @InjectQueue(MODERATION_EVIDENCE_SWEEP_QUEUE) private readonly queue: Queue,
    private readonly reportsService: ReportsService,
    private readonly reviewService: ReviewService,
    private readonly metrics: MetricsService,
  ) {
    super();
  }

  /** Register the repeatable sweep job once the queue is available. */
  async onModuleInit(): Promise<void> {
    await registerSweepWithRetry({
      queue: this.queue,
      queueName: MODERATION_EVIDENCE_SWEEP_QUEUE,
      jobName: SWEEP_JOB_NAME,
      jobOptions: sweepJobOptions(SWEEP_EVERY_MS, SWEEP_JOB_NAME),
      metrics: this.metrics,
      logger: this.logger,
      successMessage: `Registered repeatable moderation-evidence retention sweep (every ${SWEEP_EVERY_MS / 3_600_000}h)`,
    });
  }

  /** Execute one sweep pass: purge expired report + event evidence blobs. */
  async process(_job: Job): Promise<{ reports: number; events: number }> {
    const [reports, events] = await Promise.all([
      this.reportsService.sweepExpiredEvidence(),
      this.reviewService.sweepExpiredEvidence(),
    ]);
    if (reports > 0 || events > 0) {
      this.logger.log(
        `Purged expired evidence: ${reports} report frame(s), ${events} moderation-event frame(s)`,
      );
    }
    return { reports, events };
  }

  /** A sweep invocation ran to success — record it for completeness/alerting. */
  @OnWorkerEvent('completed')
  onCompleted(): void {
    this.metrics.queueJobCompleted(MODERATION_EVIDENCE_SWEEP_QUEUE);
  }

  /**
   * A sweep invocation errored. Log at error level with job name+id+reason and
   * bump `ruletka_queue_jobs_failed_total{queue}` so it is alertable. The failed
   * job is retained (bounded) in BullMQ's failed set for inspection.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    this.metrics.queueJobFailed(MODERATION_EVIDENCE_SWEEP_QUEUE);
    this.logger.error(
      `Moderation-evidence sweep job ${job?.name ?? SWEEP_JOB_NAME} ${job?.id ?? '(none)'} failed: ${err.message}`,
    );
  }
}
