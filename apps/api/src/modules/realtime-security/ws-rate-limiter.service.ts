import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../redis/redis.constants';
import {
  MAX_SOCKETS_PER_USER,
  type RateLimitRule,
  SOCKET_COUNT_TTL_SECONDS,
  wsHandshakeIpKey,
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
   * Consume one PRE-AUTH handshake token for a client IP, returning `true` when
   * the IP is still within `rule`'s budget for the current fixed window. Counts
   * raw WebSocket handshakes BEFORE the token is verified, so an unauthenticated
   * client cannot loop handshakes from one address (the per-user socket cap only
   * applies post-auth, keyed on a verified token a flooder never presents).
   *
   * Atomic INCR + first-hit EXPIRE in a single round-trip (one Lua call) so the
   * window TTL can never be lost between the two commands under concurrency. A
   * blank/unknown IP short-circuits to `true` — we never want a missing
   * `X-Forwarded-For` to wedge legitimate clients; nginx `limit_req` is the
   * complementary edge defence in that case.
   */
  async consumeHandshakeIp(ip: string | undefined, rule: RateLimitRule): Promise<boolean> {
    if (!ip || ip.length === 0) {
      return true;
    }
    const count = (await this.redis.eval(
      INCR_WITH_WINDOW_LUA,
      1,
      wsHandshakeIpKey(ip),
      String(rule.windowSec),
    )) as number;
    return count <= rule.max;
  }

  /**
   * Register a newly-connected socket for `userId`, returning whether the user
   * is now WITHIN the concurrent-socket cap. When the cap is exceeded the count
   * is rolled back (so the rejected socket does not inflate the live total) and
   * `false` is returned — the caller should disconnect the socket.
   *
   * INCR + TTL re-arm + over-cap rollback run as ONE atomic Lua script so a
   * concurrent connect from the same user can never interleave between the steps
   * (which previously risked a lost EXPIRE or a mis-ordered decrement leaving the
   * live count untruthful). The TTL is re-armed on every admitted connect so an
   * active user's counter never lapses mid-session, while an abandoned counter
   * still self-heals.
   */
  async registerSocket(userId: string): Promise<boolean> {
    const count = (await this.redis.eval(
      REGISTER_SOCKET_LUA,
      1,
      wsSocketCountKey(userId),
      String(SOCKET_COUNT_TTL_SECONDS),
      String(MAX_SOCKETS_PER_USER),
    )) as number;
    // The script returns the post-admission count, or 0 when it rolled an
    // over-cap connection back (so this socket must be rejected).
    return count > 0;
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

/**
 * Fixed-window INCR with a first-hit EXPIRE, atomic in a single round-trip.
 * `KEYS[1]` = counter key, `ARGV[1]` = window seconds. Arms the TTL exactly once
 * (on the 0→1 edge) so the window can never be lost between INCR and EXPIRE under
 * concurrency, and a lapsed key naturally resets the window. Returns the new
 * count; the caller compares it against the rule's `max`. Mirrors the
 * presence-module's `CONN_INCR_LUA` technique.
 */
const INCR_WITH_WINDOW_LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return n
`;

/**
 * Atomic concurrent-socket admission. `KEYS[1]` = per-user socket counter,
 * `ARGV[1]` = counter TTL seconds, `ARGV[2]` = max sockets per user. INCRs the
 * counter and re-arms its TTL; if the post-increment count exceeds the cap it
 * DECRs back (so a rejected, over-cap connection never inflates the live total)
 * and returns 0. Otherwise returns the admitted count (always > 0). Doing the
 * INCR / EXPIRE / over-cap rollback in one script removes the interleaving race
 * the previous three-command sequence had under concurrent connects.
 */
const REGISTER_SOCKET_LUA = `
local n = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[1])
if n > tonumber(ARGV[2]) then
  redis.call('DECR', KEYS[1])
  return 0
end
return n
`;
