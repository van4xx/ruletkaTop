import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  ThrottlerModule as NestThrottlerModule,
  type ThrottlerModuleOptions,
  type ThrottlerOptions,
} from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type { Redis } from 'ioredis';

import { RedisModule } from '../../redis/redis.module';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import {
  AUTH_THROTTLE_LIMIT,
  AUTH_THROTTLER,
  DEFAULT_THROTTLE_LIMIT,
  ONE_MINUTE_MS,
} from './throttler.constants';

/** Read a positive-int env override, else the provided default. */
function intFromEnv(config: ConfigService, key: string, fallback: number): number {
  const raw = config.get<string>(key);
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Wires `@nestjs/throttler` v6 app-wide with TWO named throttlers:
 *  - `default` — global per-IP ceiling (`THROTTLE_LIMIT`, default
 *    {@link DEFAULT_THROTTLE_LIMIT}/min) protecting every route.
 *  - {@link AUTH_THROTTLER} — strict per-IP limit (`AUTH_THROTTLE_LIMIT`, default
 *    {@link AUTH_THROTTLE_LIMIT}/min) that the auth controller opts routes into
 *    with `@Throttle({ [AUTH_THROTTLER]: { … } })`.
 *
 * Storage is backed by the SHARED ioredis client ({@link REDIS_CLIENT}) via
 * `@nest-lab/throttler-storage-redis@1.2.0` (peer-compatible with throttler v6 /
 * Nest 11 / ioredis 5), so limits hold ACROSS instances. Because we hand it the
 * existing client, its `disconnectRequired` stays falsy and it will not close our
 * connection on module destroy. If the shared client is somehow absent we fall
 * back to the built-in in-memory store (per-instance only) and log a warning.
 *
 * The integrator registers `APP_GUARD → ThrottlerBehindProxyGuard` in
 * `AppModule` and `app.set('trust proxy', …)` in `main.ts` so the per-IP tracker
 * sees the real client address behind the proxy.
 */
@Module({
  imports: [
    NestThrottlerModule.forRootAsync({
      imports: [ConfigModule, RedisModule],
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (config: ConfigService, redis: Redis): ThrottlerModuleOptions => {
        const logger = new Logger('ThrottlerModule');
        const throttlers: ThrottlerOptions[] = [
          {
            name: 'default',
            ttl: ONE_MINUTE_MS,
            limit: intFromEnv(config, 'THROTTLE_LIMIT', DEFAULT_THROTTLE_LIMIT),
          },
          {
            name: AUTH_THROTTLER,
            ttl: ONE_MINUTE_MS,
            limit: intFromEnv(config, 'AUTH_THROTTLE_LIMIT', AUTH_THROTTLE_LIMIT),
          },
        ];

        if (redis) {
          return {
            throttlers,
            storage: new ThrottlerStorageRedisService(redis),
          };
        }

        // Defensive: without Redis, degrade to in-memory storage (per-instance).
        logger.warn(
          'Redis client unavailable; throttler falling back to in-memory storage ' +
            '(rate limits will NOT be shared across instances).',
        );
        return { throttlers };
      },
    }),
  ],
  exports: [NestThrottlerModule],
})
export class ThrottlerModule {}
