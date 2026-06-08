import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Registry } from 'prom-client';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.constants';
import { MATCH_TYPES, matchmakingPoolKey, METRIC_PREFIX } from './metrics.constants';

/**
 * Owns a DEDICATED prom-client {@link Registry} (not the global default one, so
 * tests / multiple instances never double-register) and every application
 * metric. Injected wherever a domain event should bump a counter — kept loosely
 * coupled: callers depend only on this small service, never on prom-client.
 *
 * Metrics exposed (in addition to prom-client's default `process_*`/`nodejs_*`):
 * - `ruletka_active_socket_connections` (gauge) — live `/mm` sockets on THIS
 *   node, driven by the matchmaking gateway connect/disconnect lifecycle.
 * - `ruletka_matchmaking_queue_depth{type}` (gauge) — waiters per modality,
 *   read PULL-style from Redis on each scrape (no hot-path coupling).
 * - `ruletka_matches_created_total` (counter) — pairings made.
 * - `ruletka_notifications_sent_total` (counter) — notifications persisted+fanned.
 * - `ruletka_queue_jobs_completed_total{queue}` (counter) — background sweep jobs
 *   that ran to success, per queue.
 * - `ruletka_queue_jobs_failed_total{queue}` (counter) — background sweep jobs
 *   that errored (after exhausting retries BullMQ stops re-driving them), per
 *   queue. The primary alerting signal for the repeatable sweeps.
 * - `ruletka_queue_register_failures_total{queue}` (counter) — boot-time
 *   failures to (re)register a repeatable sweep schedule (e.g. a Redis blip at
 *   startup), per queue. A non-zero value means a sweep may be UNSCHEDULED on
 *   this node — alert on it.
 *
 * Always-on and Sentry-independent: this is cheap and safe to run with error
 * tracking disabled.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);

  /** Private registry so we never touch prom-client's global default registry. */
  private readonly registry = new Registry();

  private readonly activeSockets: Gauge<string>;
  private readonly matchesCreated: Counter<string>;
  private readonly notificationsSent: Counter<string>;
  private readonly queueJobsCompleted: Counter<string>;
  private readonly queueJobsFailed: Counter<string>;
  private readonly queueRegisterFailures: Counter<string>;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    // ── Live socket connections (per node) ────────────────────────────────
    this.activeSockets = new Gauge({
      name: `${METRIC_PREFIX}active_socket_connections`,
      help: 'Currently connected /mm websocket clients on this instance.',
      registers: [this.registry],
    });

    // ── Matchmaking queue depth (per modality) ────────────────────────────
    // PULL-based: the `collect` callback reads each pool's ZCARD from Redis at
    // scrape time, so enqueue/dequeue stay on a hot path with zero metrics
    // coupling. Best-effort — a Redis blip yields a stale/zero sample, never an
    // error that would fail the scrape. The gauge is captured by reference and
    // updated via `.set()` (an arrow keeps `this` = the service for `redis`).
    const queueDepth = new Gauge<'type'>({
      name: `${METRIC_PREFIX}matchmaking_queue_depth`,
      help: 'Users currently waiting in the matchmaking pool, by modality.',
      labelNames: ['type'],
      registers: [this.registry],
      collect: async (): Promise<void> => {
        await Promise.all(
          MATCH_TYPES.map(async (type) => {
            try {
              const depth = await this.redis.zcard(matchmakingPoolKey(type));
              queueDepth.set({ type }, depth);
            } catch {
              // Leave the previous sample in place on a transient Redis error.
            }
          }),
        );
      },
    });

    // ── Domain counters ───────────────────────────────────────────────────
    this.matchesCreated = new Counter({
      name: `${METRIC_PREFIX}matches_created_total`,
      help: 'Total roulette matches created since process start.',
      registers: [this.registry],
    });
    this.notificationsSent = new Counter({
      name: `${METRIC_PREFIX}notifications_sent_total`,
      help: 'Total notifications persisted and fanned out since process start.',
      labelNames: ['kind'],
      registers: [this.registry],
    });

    // ── Background-sweep (BullMQ) counters ────────────────────────────────
    // Per-queue so a single failing sweep is isolable in alerts. The `queue`
    // label is a closed set (one per repeatable sweep) — low cardinality.
    this.queueJobsCompleted = new Counter({
      name: `${METRIC_PREFIX}queue_jobs_completed_total`,
      help: 'Background queue jobs that ran to completion, by queue.',
      labelNames: ['queue'],
      registers: [this.registry],
    });
    this.queueJobsFailed = new Counter({
      name: `${METRIC_PREFIX}queue_jobs_failed_total`,
      help: 'Background queue jobs that errored, by queue (primary sweep alert).',
      labelNames: ['queue'],
      registers: [this.registry],
    });
    this.queueRegisterFailures = new Counter({
      name: `${METRIC_PREFIX}queue_register_failures_total`,
      help: 'Boot-time failures to (re)register a repeatable sweep schedule, by queue.',
      labelNames: ['queue'],
      registers: [this.registry],
    });
  }

  /**
   * Register prom-client's default Node/process metrics (event-loop lag, heap,
   * GC, CPU, handles …) on OUR registry. Done in `onModuleInit` rather than the
   * constructor so it runs exactly once per app instance, after DI settles.
   */
  onModuleInit(): void {
    collectDefaultMetrics({ register: this.registry, prefix: METRIC_PREFIX });
    this.logger.log('Prometheus metrics registered (default + custom).');
  }

  // ── Gateway-driven socket gauge ──────────────────────────────────────────

  /** A new `/mm` socket connected on this node. */
  socketConnected(): void {
    this.activeSockets.inc();
  }

  /** A `/mm` socket disconnected from this node. */
  socketDisconnected(): void {
    this.activeSockets.dec();
  }

  // ── Domain counters ──────────────────────────────────────────────────────

  /** A roulette pairing was created. */
  matchCreated(): void {
    this.matchesCreated.inc();
  }

  /**
   * A notification was created + fanned out. Labelled by `kind` for per-type
   * volume breakdowns (kept low-cardinality — `kind` is a closed enum).
   */
  notificationSent(kind: string): void {
    this.notificationsSent.inc({ kind });
  }

  // ── Background-sweep (BullMQ) counters ────────────────────────────────────

  /** A background sweep job ran to completion on the named queue. */
  queueJobCompleted(queue: string): void {
    this.queueJobsCompleted.inc({ queue });
  }

  /** A background sweep job errored on the named queue (primary sweep alert). */
  queueJobFailed(queue: string): void {
    this.queueJobsFailed.inc({ queue });
  }

  /**
   * Registering a repeatable sweep schedule failed at boot (e.g. a Redis blip).
   * A non-zero value means the sweep may be UNSCHEDULED on this node.
   */
  queueRegisterFailed(queue: string): void {
    this.queueRegisterFailures.inc({ queue });
  }

  // ── Scrape surface (used by MetricsController) ───────────────────────────

  /** The Prometheus exposition-format content type (`text/plain; version=…`). */
  get contentType(): string {
    return this.registry.contentType;
  }

  /** Render the current metric snapshot in Prometheus exposition format. */
  async render(): Promise<string> {
    return this.registry.metrics();
  }
}
