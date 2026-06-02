import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Redis, type RedisOptions } from 'ioredis';

import { REDIS_CLIENT } from './redis.constants';

/**
 * Builds {@link RedisOptions} from environment configuration.
 *
 * Exported so other infrastructure (BullMQ root, the Socket.io Redis adapter)
 * can construct their own dedicated connections from the SAME settings without
 * sharing the application's primary client. BullMQ in particular REQUIRES its
 * own connection because it issues blocking commands and needs
 * `maxRetriesPerRequest: null`.
 */
export function buildRedisOptions(config: ConfigService): RedisOptions {
  const password = config.get<string>('REDIS_PASSWORD');
  return {
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: config.get<number>('REDIS_PORT', 6379),
    // Treat empty-string passwords (common in .env) as "no auth".
    password: password && password.length > 0 ? password : undefined,
    // Keep trying to reconnect with capped backoff rather than throwing.
    retryStrategy: (times: number) => Math.min(times * 200, 2000),
    lazyConnect: false,
  };
}

/**
 * Global module exposing a single shared {@link Redis} client under the
 * {@link REDIS_CLIENT} token, used for app-level caching / pub-sub helpers.
 *
 * Note: the Socket.io adapter and BullMQ create their OWN connections (see
 * {@link buildRedisOptions}) — a blocking BullMQ worker must never share a
 * connection with request-path code.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        const client = new Redis(buildRedisOptions(config));
        const logger = new Logger('RedisModule');
        client.on('error', (err: Error) => logger.error(`Redis error: ${err.message}`));
        client.on('connect', () => logger.log('Redis client connected'));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  /** Gracefully closes the shared connection so the process can exit cleanly. */
  async onApplicationShutdown(): Promise<void> {
    try {
      await this.client.quit();
      this.logger.log('Redis client closed');
    } catch (err) {
      this.logger.warn(`Error closing Redis client: ${(err as Error).message}`);
    }
  }
}
