import type { MatchType } from '@ruletka/shared-types';

/**
 * Redis key helpers and tunables for the matchmaking subsystem.
 *
 * Live pool/room state lives ENTIRELY in Redis (the durable {@link Match} log is
 * Mongo, owned by {@link MatchService}). Keeping it in Redis lets any API
 * instance match, tear down and rate-limit, with the Socket.io Redis adapter
 * delivering events to whichever node a peer is connected to.
 */

/** ZSET of waiting users for a modality, scored so the next-to-serve sorts first. */
export function poolKey(type: MatchType): string {
  return `mm:pool:${type}`;
}

/** HASH holding one waiter's full {@link WaiterEntry} while they sit in the pool. */
export function waiterKey(userId: string): string {
  return `mm:waiter:${userId}`;
}

/** HASH holding a live room's {@link RoomState} for the duration of a call. */
export function roomKey(roomId: string): string {
  return `mm:room:${roomId}`;
}

/** STRING pointer (JSON {@link UserRoomPointer}) from a user to their current room. */
export function userRoomKey(userId: string): string {
  return `mm:userroom:${userId}`;
}

/** Fixed-window counter key for `mm:next` rate-limiting, per user. */
export function nextRateKey(userId: string): string {
  return `mm:nextrate:${userId}`;
}

/**
 * STRING key (JSON {@link PendingCall}) holding a ringing 1:1 friend call until
 * it is accepted, declined, ended or the ring times out. Keyed by the minted
 * `callId` so the callee's `call:accept|decline` can validate + resolve it.
 */
export function callKey(callId: string): string {
  return `mm:call:${callId}`;
}

/**
 * Socket.io room a 1:1 friend call's two participants join on accept
 * (`call:<callId>`). The ensuing WebRTC signaling (`rtc:*` with `roomId =
 * callId`) relays between the room's members exactly like a matchmaking room.
 */
export function callRoom(callId: string): string {
  return `call:${callId}`;
}

/**
 * TTL (seconds) for a pending (ringing) call — the ring timeout. After this the
 * pending-call key self-expires so a never-answered invite cannot linger; the
 * caller's UI also auto-cancels on its own timer.
 */
export const CALL_RING_TTL_SECONDS = 60;

/**
 * Priority weight applied to premium users in the pool score. A waiter's score
 * is `joinedAt - (isPremium ? PREMIUM_PRIORITY_BONUS : 0)`, so premium users
 * sort ahead of everyone who joined within ~3 years of them while still being
 * FIFO-ordered among themselves. The constant is large enough to dominate any
 * realistic `joinedAt` (epoch-ms) spread between concurrent waiters.
 */
export const PREMIUM_PRIORITY_BONUS = 1_000_000_000_000;

/** How many candidates to pull from the pool per match attempt before giving up. */
export const MATCH_CANDIDATE_BATCH = 20;

/** TTL (seconds) for a waiter hash — a dead/stale waiter self-expires from Redis. */
export const WAITER_TTL_SECONDS = 600;

/** TTL (seconds) for a room hash + user→room pointer — bounds orphaned rooms. */
export const ROOM_TTL_SECONDS = 6 * 60 * 60;

/** `mm:next` rate limit: at most {@link NEXT_MAX_PER_WINDOW} calls per window. */
export const NEXT_MAX_PER_WINDOW = 10;

/** Sliding fixed window (seconds) for the `mm:next` rate limit. */
export const NEXT_WINDOW_SECONDS = 10;
