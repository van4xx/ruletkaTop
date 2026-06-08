import { Logger } from '@nestjs/common';
import type { JobsOptions, Queue } from 'bullmq';

import type { MetricsService } from './metrics.service';

/**
 * Shared resilience helpers for the repeatable background "sweeps"
 * (subscription-expiry, top-expiry, match-reconciliation). Centralised here so
 * all three sweeps share ONE failure/retention/boot-resilience policy instead
 * of drifting copy-paste.
 *
 * See {@link MetricsService} for the `ruletka_queue_*` counters these helpers
 * drive, and `infra/README.md` (Observability) for how to scrape them across
 * replicas.
 */

/**
 * How many times a single sweep INVOCATION is retried before BullMQ marks it
 * permanently failed (and stops re-driving it until the next repeat tick). The
 * sweeps are idempotent, so a couple of retries ride out a transient Mongo/Redis
 * blip without masking a real, persistent failure.
 */
export const SWEEP_JOB_ATTEMPTS = 3;

/** Exponential backoff base (ms) between retries: 5s, 10s, 20s …. */
const SWEEP_BACKOFF_MS = 5_000;

/**
 * How many permanently-FAILED jobs to retain per queue for post-mortem
 * inspection. A BOUNDED count (never `true`, which would keep them unbounded,
 * and never `false`/`0`, which would discard the evidence): failures stay
 * inspectable via BullMQ's failed set without growing without limit. This is the
 * lightweight "dead-letter" the audit asked for.
 */
export const SWEEP_KEEP_FAILED = 100;

/** How many completed jobs to retain (small — sweeps run frequently). */
const SWEEP_KEEP_COMPLETED = 20;

/**
 * The canonical {@link JobsOptions} every repeatable sweep registers with.
 * Bundles the repeat cadence with bounded retry/backoff and bounded retention
 * so a permanently-failed job is RETAINED (inspectable) rather than silently
 * dropped.
 *
 * @param everyMs repeat cadence in milliseconds
 * @param jobId   stable job id (de-dupes the schedule across boots/replicas)
 */
export function sweepJobOptions(everyMs: number, jobId: string): JobsOptions {
  return {
    // A stable repeat key means re-adding on every boot is idempotent — BullMQ
    // keeps a single schedule instead of accumulating duplicate timers.
    repeat: { every: everyMs },
    jobId,
    attempts: SWEEP_JOB_ATTEMPTS,
    backoff: { type: 'exponential', delay: SWEEP_BACKOFF_MS },
    // Retain a bounded history. removeOnFail is a COUNT (not `true`) so a
    // permanently-failed job stays inspectable in the failed set.
    removeOnComplete: SWEEP_KEEP_COMPLETED,
    removeOnFail: SWEEP_KEEP_FAILED,
  };
}

/** How many times boot-time registration is retried before degrading. */
const REGISTER_MAX_ATTEMPTS = 3;

/** Linear-ish delay (ms) between registration retries. */
const REGISTER_RETRY_DELAY_MS = 1_000;

/**
 * Register a repeatable sweep at boot with bounded retry, surfacing failures
 * LOUDLY (error log + `ruletka_queue_register_failures_total` metric) instead
 * of swallowing them — but DEGRADING rather than crashing the whole API for a
 * scheduler hiccup (mirrors the throttler's fail-open posture). The schedule
 * self-heals on the next restart even if all retries here are exhausted.
 *
 * @returns `true` if the schedule was registered, `false` if it degraded.
 */
export async function registerSweepWithRetry(opts: {
  queue: Queue;
  queueName: string;
  jobName: string;
  jobOptions: JobsOptions;
  metrics: MetricsService;
  logger: Logger;
  successMessage: string;
}): Promise<boolean> {
  const { queue, queueName, jobName, jobOptions, metrics, logger, successMessage } = opts;

  for (let attempt = 1; attempt <= REGISTER_MAX_ATTEMPTS; attempt += 1) {
    try {
      await queue.add(jobName, {}, jobOptions);
      logger.log(successMessage);
      return true;
    } catch (err) {
      const reason = (err as Error).message;
      if (attempt < REGISTER_MAX_ATTEMPTS) {
        logger.warn(
          `Failed to register ${queueName} sweep (attempt ${attempt}/${REGISTER_MAX_ATTEMPTS}): ${reason} — retrying`,
        );
        await delay(REGISTER_RETRY_DELAY_MS * attempt);
        continue;
      }
      // Exhausted: do NOT crash the API for a sweep-scheduler hiccup. Surface it
      // loudly (error + metric) so it is alertable; the next restart re-tries.
      metrics.queueRegisterFailed(queueName);
      logger.error(
        `Failed to register ${queueName} sweep after ${REGISTER_MAX_ATTEMPTS} attempts: ${reason} — sweep is UNSCHEDULED on this node until restart`,
      );
      return false;
    }
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
