/**
 * DI token for the shared ioredis client provided by {@link RedisModule}.
 * Inject with `@Inject(REDIS_CLIENT) private readonly redis: Redis`.
 */
export const REDIS_CLIENT = 'REDIS_CLIENT';
