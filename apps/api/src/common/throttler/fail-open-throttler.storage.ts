import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

/**
 * A {@link ThrottlerStorage} decorator that FAILS OPEN when the underlying store
 * (Redis) throws.
 *
 * Without this, the Redis-backed throttler has no error fallback: a Redis outage
 * (connection refused, command timeout, cluster failover) makes every
 * `increment` reject, the guard lets that reject bubble, and Nest turns it into a
 * `500` on EVERY request — a cache blip takes the whole API down. Rate limiting
 * is a best-effort protective measure, NOT a hard correctness dependency, so the
 * right degradation is to ALLOW the request (log + count as "no hits recorded")
 * rather than to reject it.
 *
 * On a storage error we synthesise a record that reports the throttler as
 * un-tripped (`totalHits: 0`, not blocked) so the guard treats the request as
 * under-limit and proceeds. We log at WARN (throttled to one line per
 * {@link ERROR_LOG_INTERVAL_MS} so a sustained outage can't flood the logs) and
 * surface a short-lived counter for observability. When Redis recovers, calls
 * resume hitting it transparently — no restart needed.
 *
 * This wraps any storage; we only ever construct it around the Redis storage
 * (the in-memory fallback never throws), so the open-circuit behaviour is scoped
 * to the failure mode that actually matters.
 */
export class FailOpenThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('ThrottlerStorage');

  /** Wall-clock ms of the last emitted error log, for log-rate-limiting. */
  private lastErrorLogAt = 0;

  /** Count of fail-open events since process start (observability/tests). */
  private failOpenCount = 0;

  /** Minimum gap between error logs during a sustained outage (1 per 5s). */
  private static readonly ERROR_LOG_INTERVAL_MS = 5_000;

  constructor(private readonly inner: ThrottlerStorage) {}

  /** Number of requests allowed through because the store errored. */
  get failOpenEvents(): number {
    return this.failOpenCount;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      return await this.inner.increment(key, ttl, limit, blockDuration, throttlerName);
    } catch (err) {
      this.failOpenCount += 1;
      this.logFailure(err);
      // Synthesise an "under limit, not blocked" record so the guard ALLOWS the
      // request. `totalHits: 0` (no hits recorded — we couldn't), full ttl left,
      // and explicitly not blocked.
      return {
        totalHits: 0,
        timeToExpire: ttl,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }

  /** WARN once per interval during an outage so logs don't flood. */
  private logFailure(err: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLogAt < FailOpenThrottlerStorage.ERROR_LOG_INTERVAL_MS) {
      return;
    }
    this.lastErrorLogAt = now;
    const reason = err instanceof Error ? err.message : String(err);
    this.logger.warn(
      `Throttler storage error — FAILING OPEN (allowing request; rate limits not ` +
        `enforced until the store recovers). Cause: ${reason}`,
    );
  }
}
