import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../redis/redis.constants';
import {
  MAX_SOCKETS_PER_USER,
  type RateLimitRule,
  SOCKET_COUNT_TTL_SECONDS,
  wsRateKey,
  wsSocketCountKey,
} from './realtime-security.constants';

/**
 * Per-user WebSocket rate limiting and concurrent-socket accounting, backed by
 * Redis so the limit is enforced consistently across all API instances.
 *
 * Token buckets reuse the exact fixed-window technique as
 * `MatchmakingService.consumeNextToken`: `INCR` the per-user/per-action counter
 * and set the window TTL only on the first hit; reject once the count exceeds
 * the rule's `max`. A lapsed key resets the window.
 *
 * Concurrent sockets are tracked with a per-user counter that the gateways
 * increment on connect and decrement on disconnect; a TTL guards against leaks
 * from missed disconnects.
 */
@Injectable()
export class WsRateLimiterService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Consume one token for `rule` on behalf of `userId`. Returns `true` when the
   * action is allowed, `false` when the user has exceeded the rule's `max`
   * within its window. First hit in a window arms the TTL exactly once.
   */
  async consume(userId: string, rule: RateLimitRule): Promise<boolean> {
    const key = wsRateKey(rule.action, userId);
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, rule.windowSec);
    }
    return count <= rule.max;
  }

  /**
   * Register a newly-connected socket for `userId`, returning whether the user
   * is now WITHIN the concurrent-socket cap. When the cap is exceeded the count
   * is rolled back (so the rejected socket does not inflate the live total) and
   * `false` is returned — the caller should disconnect the socket.
   */
  async registerSocket(userId: string): Promise<boolean> {
    const key = wsSocketCountKey(userId);
    const count = await this.redis.incr(key);
    // Re-arm the TTL each connect so an active user's counter never lapses
    // mid-session, while an abandoned counter still self-heals.
    await this.redis.expire(key, SOCKET_COUNT_TTL_SECONDS);
    if (count > MAX_SOCKETS_PER_USER) {
      // Roll back this over-limit connection so the live count stays truthful.
      await this.redis.decr(key);
      return false;
    }
    return true;
  }

  /**
   * Account for a socket disconnecting. Decrements the user's live socket
   * counter, clamping at zero (a stray decrement must never drive it negative).
   */
  async releaseSocket(userId: string): Promise<void> {
    const key = wsSocketCountKey(userId);
    const count = await this.redis.decr(key);
    if (count <= 0) {
      // At/under zero: drop the key entirely so it cannot go negative and so a
      // fully-disconnected user leaves no residue.
      await this.redis.del(key);
    }
  }
}
