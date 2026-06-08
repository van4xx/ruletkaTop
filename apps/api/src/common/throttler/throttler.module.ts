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
import { FailOpenThrottlerStorage } from './fail-open-throttler.storage';
import {
  AUTH_THROTTLE_LIMIT,
  AUTH_THROTTLER,
  DEFAULT_THROTTLE_LIMIT,
  ONE_MINUTE_MS,
  REFRESH_THROTTLE_LIMIT,
  REFRESH_THROTTLER,
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
 * Wires `@nestjs/throttler` v6 app-wide with THREE named throttlers:
 *  - `default` — global per-IP ceiling (`THROTTLE_LIMIT`, default
 *    {@link DEFAULT_THROTTLE_LIMIT}/min) protecting every route.
 *  - {@link AUTH_THROTTLER} — strict per-IP limit (`AUTH_THROTTLE_LIMIT`, default
 *    {@link AUTH_THROTTLE_LIMIT}/min) that the auth controller opts credential
 *    routes (login/register/…) into with `@Throttle({ [AUTH_THROTTLER]: { … } })`.
 *  - {@link REFRESH_THROTTLER} — generous per-IP limit (`REFRESH_THROTTLE_LIMIT`,
 *    default {@link REFRESH_THROTTLE_LIMIT}/min) that ONLY `/auth/refresh` opts
 *    into. Refresh is fired silently and often (proactive, cold-start, on-resume),
 *    so a 429 here must not be possible under normal navigation — a refresh 429
 *    used to cascade into a spurious client logout.
 *
 * Storage is backed by the SHARED ioredis client ({@link REDIS_CLIENT}) via
 * `@nest-lab/throttler-storage-redis@1.2.0` (peer-compatible with throttler v6 /
 * Nest 11 / ioredis 5), so limits hold ACROSS instances. The Redis store is
 * wrapped in {@link FailOpenThrottlerStorage}: if Redis is unreachable mid-flight
 * (timeout / connection refused / failover) the wrapper ALLOWS the request and
 * logs, instead of letting the error 500 every request — rate limiting is
 * best-effort, never a hard availability dependency. Because we hand the store
 * the existing client, its `disconnectRequired` stays falsy and it will not close
 * our connection on module destroy. If the shared client is somehow absent at
 * boot we fall back to the built-in in-memory store (per-instance only) and warn.
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
          {
            // Generous bucket for the silent token-refresh endpoint, kept separate
            // from the strict `auth` login/register limit. Sized so heavy
            // navigation never 429s the refresh (which the web used to mistake for
            // a session-expiry → spurious logout).
            name: REFRESH_THROTTLER,
            ttl: ONE_MINUTE_MS,
            limit: intFromEnv(config, 'REFRESH_THROTTLE_LIMIT', REFRESH_THROTTLE_LIMIT),
          },
        ];

        if (redis) {
          return {
            throttlers,
            // Wrap the Redis store so a cache outage FAILS OPEN (allow + log)
            // instead of 500-ing every request. Rate limiting is best-effort, not
            // a hard dependency — a Redis blip must never take the whole API down.
            storage: new FailOpenThrottlerStorage(new ThrottlerStorageRedisService(redis)),
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
