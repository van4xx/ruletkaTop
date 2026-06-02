/**
 * Redis key / channel helpers and tunables for the presence subsystem.
 *
 * Presence is stored ENTIRELY in Redis (no Mongo): a per-user status key with a
 * short TTL acts as a heartbeat — while the client keeps refreshing it (on
 * connect + periodic `presence:heartbeat`) the user is considered reachable;
 * once the key lapses the user is implicitly offline. Transitions are published
 * on a pub/sub channel so any API instance can fan the change out to interested
 * sockets.
 */

/** Per-user status key, e.g. `presence:status:<userId>` → OnlineStatus. */
export function presenceStatusKey(userId: string): string {
  return `presence:status:${userId}`;
}

/**
 * Pub/sub channel carrying presence transitions as JSON
 * `{ userId, status }` (a {@link PresencePayload}). Gateways subscribe to relay
 * to subscribed sockets across nodes.
 */
export const PRESENCE_CHANNEL = 'presence:events';

/**
 * TTL (seconds) for a presence key. Must comfortably exceed the client
 * heartbeat interval so a single missed beat does not flap the user offline.
 * Overridable via `PRESENCE_TTL_SECONDS`.
 */
export const DEFAULT_PRESENCE_TTL_SECONDS = 60;
