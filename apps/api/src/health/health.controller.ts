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
 * Liveness/readiness endpoint. Actively pings MongoDB (`admin ping`) and Redis
 * (`PING`) so orchestrators can distinguish "process up" from "dependencies
 * reachable". Responds `200` when healthy and `503` when any dependency is
 * down, while always returning the detailed per-dependency body.
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
      await this.mongoConnection.db.admin().ping();
      return { status: 'up' };
    } catch (err) {
      return { status: 'down', detail: (err as Error).message };
    }
  }

  private async checkRedis(): Promise<DependencyHealth> {
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG' ? { status: 'up' } : { status: 'down', detail: pong };
    } catch (err) {
      return { status: 'down', detail: (err as Error).message };
    }
  }
}
