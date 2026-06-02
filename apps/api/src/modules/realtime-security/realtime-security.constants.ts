/**
 * Redis key / channel helpers and tunables for WebSocket security: per-user
 * rate limiting, concurrent-socket caps and forced disconnect on ban.
 *
 * All live counters are kept in Redis so any API instance enforces the same
 * limits and so a ban published on one node disconnects the user's sockets on
 * whichever node(s) actually hold them (the Socket.io Redis adapter handles the
 * delivery; the disconnect itself is driven by the {@link USER_DISCONNECT_CHANNEL}
 * pub/sub below).
 */

/**
 * Pub/sub channel on which the moderation module PUBLISHES a banned user id
 * (the raw 24-hex string) when an account is banned. Every gateway SUBSCRIBES
 * and force-disconnects that user's local sockets.
 *
 * Contract (shared with the moderation agent): the message body is the plain
 * user id string, e.g. `"507f1f77bcf86cd799439011"`.
 */
export const USER_DISCONNECT_CHANNEL = 'user:disconnect';

/**
 * Per-user, per-action fixed-window counter key. Mirrors the `mm:next` limiter:
 * INCR on each use, EXPIRE on the first hit, reject once the count exceeds the
 * action's cap within the window.
 */
export function wsRateKey(action: string, userId: string): string {
  return `ws:rate:${action}:${userId}`;
}

/** Per-user live socket counter key (incremented on connect, decremented on disconnect). */
export function wsSocketCountKey(userId: string): string {
  return `ws:sockets:${userId}`;
}

/** TTL (seconds) guarding the socket counter against leaks from missed disconnects. */
export const SOCKET_COUNT_TTL_SECONDS = 6 * 60 * 60;

/** The most concurrent sockets a single user may hold across the cluster. */
export const MAX_SOCKETS_PER_USER = 10;

/**
 * Token-bucket limits per realtime action: at most `max` events per `windowSec`
 * fixed window, per user. Tuned to be generous for humans but to cap abusive
 * floods (signaling storms, message spam, rapid re-queues).
 */
export interface RateLimitRule {
  /** Stable key segment used in the Redis counter key. */
  readonly action: string;
  /** Max events allowed within the window. */
  readonly max: number;
  /** Fixed window length in seconds. */
  readonly windowSec: number;
}

/** `chat:message` — generous for fast typers, caps spam. */
export const CHAT_MESSAGE_LIMIT: RateLimitRule = {
  action: 'chat:message',
  max: 30,
  windowSec: 10,
};

/** `mm:join` — re-queue/join bursts. */
export const MM_JOIN_LIMIT: RateLimitRule = {
  action: 'mm:join',
  max: 20,
  windowSec: 10,
};

/**
 * `rtc:*` signaling relays (offer/answer/ice). ICE trickling can be chatty, so
 * this is the most permissive bucket; it exists to stop a peer weaponising the
 * relay against the other side, not to throttle a healthy negotiation.
 */
export const RTC_SIGNAL_LIMIT: RateLimitRule = {
  action: 'rtc:signal',
  max: 100,
  windowSec: 10,
};
