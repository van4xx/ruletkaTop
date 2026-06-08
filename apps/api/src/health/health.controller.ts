import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Connection } from 'mongoose';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.constants';

/** Per-dependency health entry. */
interface DependencyHealth {
  status: 'up' | 'down';
  detail?: string;
}

/** Aggregate health payload returned by `GET /health`. */
interface HealthResponse {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  dependencies: {
    mongo: DependencyHealth;
    redis: DependencyHealth;
  };
}

/**
 * Per-dependency ping budget (ms). A health probe must answer FAST — if a
 * dependency hangs (half-open TCP, an unresponsive primary mid-failover, a Redis
 * paused for RDB save) an un-bounded `ping()` would stall the whole probe and the
 * orchestrator's readiness check times out at the HTTP layer instead of getting a
 * clean `503`. We race each check against this budget and report the slow
 * dependency as `down` ("timeout") so the probe always returns promptly.
 */
const HEALTH_CHECK_TIMEOUT_MS = 2_000;

/** Sentinel a timed-out check rejects with, so we can tag the detail cleanly. */
const TIMEOUT_REASON = 'timeout';

/**
 * Liveness/readiness endpoint. Actively pings MongoDB (`admin ping`) and Redis
 * (`PING`) so orchestrators can distinguish "process up" from "dependencies
 * reachable". Responds `200` when healthy and `503` when any dependency is
 * down, while always returning the detailed per-dependency body.
 *
 * Each dependency ping is bounded by {@link HEALTH_CHECK_TIMEOUT_MS} (via
 * `Promise.race`) so a HUNG dependency yields a fast, clean `503` instead of
 * stalling the probe until the caller's own HTTP timeout fires.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Service + dependency health (mongo, redis)' })
  @ApiResponse({ status: 200, description: 'All dependencies reachable' })
  @ApiResponse({ status: 503, description: 'One or more dependencies down' })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const [mongo, redis] = await Promise.all([this.checkMongo(), this.checkRedis()]);
    const healthy = mongo.status === 'up' && redis.status === 'up';

    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: healthy ? 'ok' : 'degraded',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      dependencies: { mongo, redis },
    };
  }

  private async checkMongo(): Promise<DependencyHealth> {
    try {
      // readyState 1 === connected; also actively ping to confirm liveness.
      if (this.mongoConnection.readyState !== 1 || !this.mongoConnection.db) {
        return { status: 'down', detail: 'not connected' };
      }
      // Bound the ping so a hung primary can't stall the probe. `maxTimeMS` makes
      // the server itself abort a slow command; the outer race is the backstop for
      // a connection that never even responds (the TCP layer hanging).
      await this.withTimeout(this.mongoConnection.db.admin().ping({ maxTimeMS: HEALTH_CHECK_TIMEOUT_MS }));
      return { status: 'up' };
    } catch (err) {
      return { status: 'down', detail: this.failureDetail(err) };
    }
  }

  private async checkRedis(): Promise<DependencyHealth> {
    try {
      const pong = await this.withTimeout(this.redis.ping());
      return pong === 'PONG' ? { status: 'up' } : { status: 'down', detail: pong };
    } catch (err) {
      return { status: 'down', detail: this.failureDetail(err) };
    }
  }

  /**
   * Race a dependency ping against {@link HEALTH_CHECK_TIMEOUT_MS}. If the ping
   * hasn't settled by then the returned promise rejects with {@link
   * TIMEOUT_REASON}, so a hung dependency surfaces as a fast `down` rather than
   * stalling the whole probe. The timer is always cleared (success or timeout) so
   * a resolved check never leaves a dangling handle holding the event loop open.
   */
  private withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(TIMEOUT_REASON)), HEALTH_CHECK_TIMEOUT_MS);
    });
    return Promise.race([work, timeout]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }) as Promise<T>;
  }

  /** Normalise a check failure into a short, safe `detail` string. */
  private failureDetail(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
