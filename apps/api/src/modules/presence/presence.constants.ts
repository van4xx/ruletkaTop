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
 * Per-user GLOBAL live-connection counter, e.g. `presence:conn:<userId>`. INCR'd
 * on every socket connect (on any API replica) and DECR'd on disconnect, so a
 * user with sockets on multiple replicas is counted exactly once. The 0→1 edge
 * drives the `online` transition and the →0 edge the `offline` one (see
 * {@link PresenceService.connect} / {@link PresenceService.disconnect}). A TTL
 * guards against a crashed replica leaking a count it can never decrement.
 */
export function presenceConnKey(userId: string): string {
  return `presence:conn:${userId}`;
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

/**
 * TTL (seconds) for the per-user connection counter. Re-armed on every connect
 * and by the gateway's periodic heartbeat so a counter never lapses while the
 * user genuinely has a live socket; if a replica crashes (its disconnects never
 * run) the counter self-heals once this lapses. Comfortably longer than the
 * gateway heartbeat cadence so a single missed beat can't drive a false reset.
 */
export const PRESENCE_CONN_TTL_SECONDS = 6 * 60 * 60;
