import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

import type { MatchType } from '@ruletka/shared-types';

import { REDIS_CLIENT } from '../../redis/redis.constants';
import { CALL_RING_TTL_SECONDS, callKey } from './matchmaking.constants';
import type { PendingCall } from './matchmaking.types';

/**
 * Redis-backed registry of ringing 1:1 friend calls — the live counterpart to a
 * matchmaking room, but for a directed invite that has not yet been answered.
 *
 * A {@link PendingCall} is stored under {@link callKey} with a short TTL (the
 * ring timeout, {@link CALL_RING_TTL_SECONDS}). The `callId` is also the
 * Socket.io room id the two participants join on accept (`call:<callId>`), so
 * the gateway can relay the ensuing `rtc:*` signaling between them.
 *
 * The gateway owns delivery (per-user rooms via the Socket.io Redis adapter) and
 * room membership; this service only owns the pending-call lifecycle so the
 * accept/decline/end paths are validated against authoritative state on any
 * replica.
 */
@Injectable()
export class CallService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Mint a `callId`, persist the pending call with the ring TTL and return it.
   * Idempotent only in the sense that each invite is a fresh call — a caller
   * re-inviting mints a new id (the prior one rings out on its own TTL).
   */
  async createPending(fromUserId: string, toUserId: string, type: MatchType): Promise<PendingCall> {
    const call: PendingCall = {
      callId: randomUUID(),
      fromUserId,
      toUserId,
      type,
      createdAt: Date.now(),
    };
    await this.redis.set(callKey(call.callId), JSON.stringify(call), 'EX', CALL_RING_TTL_SECONDS);
    return call;
  }

  /** The pending call for `callId`, or `null` if it never existed / already cleared / rang out. */
  async getPending(callId: string): Promise<PendingCall | null> {
    const raw = await this.redis.get(callKey(callId));
    return raw ? (safeParse<PendingCall>(raw) ?? null) : null;
  }

  /**
   * Atomically consume the pending call IFF it exists AND `toUserId` is its
   * intended callee — returns it (and deletes the key) on success, else `null`.
   * Used by `call:accept`/`call:decline` so a call can be answered exactly once
   * and only by the person it was placed to (a racing accept+decline, or an
   * unrelated user, gets `null`).
   */
  async consumePendingForCallee(callId: string, calleeUserId: string): Promise<PendingCall | null> {
    const raw = (await this.redis.eval(
      CONSUME_FOR_CALLEE_LUA,
      1,
      callKey(callId),
      calleeUserId,
    )) as string | null;
    return raw ? (safeParse<PendingCall>(raw) ?? null) : null;
  }

  /**
   * Clear a pending call, returning it if it existed (so `call:end` before an
   * accept, or a caller cancelling, can notify the right party). Does NOT check
   * membership — the gateway has already authorised the caller.
   */
  async clearPending(callId: string): Promise<PendingCall | null> {
    const raw = (await this.redis.eval(GETDEL_LUA, 1, callKey(callId))) as string | null;
    return raw ? (safeParse<PendingCall>(raw) ?? null) : null;
  }
}

/** Parse JSON, returning `null` instead of throwing on malformed input. */
function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Lua: atomically read + delete the pending call ONLY if its `toUserId` matches
 * ARGV[1], returning the stored JSON on success or false otherwise. Keeps
 * accept/decline single-use and scoped to the real callee even across replicas.
 * KEYS[1]=call key, ARGV[1]=callee user id.
 */
const CONSUME_FOR_CALLEE_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return false end
if string.find(raw, '"toUserId":"' .. ARGV[1] .. '"', 1, true) == nil then return false end
redis.call('DEL', KEYS[1])
return raw
`;

/**
 * Lua: atomic GET + DEL (a portable GETDEL for older Redis), returning the prior
 * value or false. KEYS[1]=call key.
 */
const GETDEL_LUA = `
local raw = redis.call('GET', KEYS[1])
if raw then redis.call('DEL', KEYS[1]) end
return raw
`;
