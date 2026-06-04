import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import type { OnlineStatus, PresencePayload } from '@ruletka/shared-types';

import { REDIS_CLIENT } from '../../redis/redis.constants';
import {
  DEFAULT_PRESENCE_TTL_SECONDS,
  PRESENCE_CHANNEL,
  PRESENCE_CONN_TTL_SECONDS,
  presenceConnKey,
  presenceStatusKey,
} from './presence.constants';

/** Handler invoked for every presence transition observed cluster-wide. */
export type PresenceEventHandler = (payload: PresencePayload) => void;

/** Statuses that mean "currently reachable" (online for delivery purposes). */
const ONLINE_STATUSES: ReadonlySet<OnlineStatus> = new Set<OnlineStatus>([
  'online',
  'in_call',
  'away',
]);

/**
 * Redis-backed presence tracker.
 *
 * State lives only in Redis under {@link presenceStatusKey} with a TTL acting as
 * a heartbeat (see {@link presence.constants}). On every change the new state is
 * PUBLISHed on {@link PRESENCE_CHANNEL}; gateways subscribe via
 * {@link onPresenceEvent} to relay to interested sockets across all instances.
 *
 * Exposed cross-module (consumed by friends/chat): {@link setStatus},
 * {@link getStatus}, {@link isOnline}.
 */
@Injectable()
export class PresenceService implements OnApplicationShutdown {
  private readonly logger = new Logger(PresenceService.name);
  private readonly ttlSeconds: number;

  /** Lazily-created dedicated SUBSCRIBE connection (Redis requires its own). */
  private subscriber?: Redis;
  /** In-process relay handlers (e.g. the chat gateway). */
  private readonly handlers = new Set<PresenceEventHandler>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.ttlSeconds = config.get<number>('PRESENCE_TTL_SECONDS', DEFAULT_PRESENCE_TTL_SECONDS);
  }

  /**
   * Records the user's status and refreshes the heartbeat TTL. When the status
   * value actually changes (including online↔offline) the transition is
   * published so subscribers can react. Always re-arms the TTL so an unchanged
   * status still counts as a heartbeat.
   */
  async setStatus(userId: string, status: OnlineStatus): Promise<void> {
    const key = presenceStatusKey(userId);

    if (status === 'offline') {
      // Going offline: drop the key entirely and announce it.
      const existed = await this.redis.del(key);
      if (existed > 0) {
        await this.publish(userId, 'offline');
      }
      return;
    }

    const previous = (await this.redis.get(key)) as OnlineStatus | null;
    // SET with expiry re-arms the heartbeat on every call.
    await this.redis.set(key, status, 'EX', this.ttlSeconds);
    if (previous !== status) {
      await this.publish(userId, status);
    }
  }

  /**
   * Refreshes the heartbeat TTL without forcing a status change, defaulting a
   * brand-new (expired) user to `online`. Returns the effective status.
   */
  async heartbeat(userId: string): Promise<OnlineStatus> {
    const key = presenceStatusKey(userId);
    const current = (await this.redis.get(key)) as OnlineStatus | null;
    const next: OnlineStatus = current ?? 'online';
    await this.redis.set(key, next, 'EX', this.ttlSeconds);
    if (current === null) {
      await this.publish(userId, next);
    }
    return next;
  }

  // ── Global connection refcount (multi-replica online/offline) ──────────────

  /**
   * Register a newly-connected socket for `userId` and report whether this was
   * the user's FIRST live connection cluster-wide (the 0→1 edge). Atomically
   * `INCR`s the per-user connection counter ({@link presenceConnKey}) and re-arms
   * its TTL, so a user holding sockets on multiple replicas is counted once.
   *
   * On the 0→1 edge we flip the user `online` (which publishes the transition);
   * subsequent connects only bump the counter. Idempotent and safe to call from
   * any replica — the counter is the single source of truth.
   */
  async connect(userId: string): Promise<void> {
    const count = (await this.redis.eval(
      CONN_INCR_LUA,
      1,
      presenceConnKey(userId),
      String(PRESENCE_CONN_TTL_SECONDS),
    )) as number;
    if (count === 1) {
      // First connection anywhere → online (setStatus publishes on change).
      await this.setStatus(userId, 'online');
    }
  }

  /**
   * Account for a socket disconnecting and report whether it was the user's LAST
   * live connection cluster-wide (the →0 edge). Atomically `DECR`s the counter,
   * clamping at zero and deleting the key once it reaches zero (so a stray
   * decrement can never drive it negative and a fully-offline user leaves no
   * residue). On the →0 edge we flip the user `offline` (which publishes).
   */
  async disconnect(userId: string): Promise<void> {
    const count = (await this.redis.eval(CONN_DECR_LUA, 1, presenceConnKey(userId))) as number;
    if (count <= 0) {
      await this.setStatus(userId, 'offline');
    }
  }

  /**
   * Re-arm the connection counter's TTL for a still-connected user (driven by
   * the gateway's periodic heartbeat). Only touches the TTL when the counter
   * actually exists, so it never resurrects a key for a user who has fully
   * disconnected. Also refreshes the status heartbeat so an active user's status
   * key never lapses mid-session.
   */
  async refreshConnection(userId: string): Promise<void> {
    await this.redis.eval(
      CONN_TOUCH_LUA,
      1,
      presenceConnKey(userId),
      String(PRESENCE_CONN_TTL_SECONDS),
    );
    await this.heartbeat(userId);
  }

  /** Current status, or `offline` when no live heartbeat exists. */
  async getStatus(userId: string): Promise<OnlineStatus> {
    const value = (await this.redis.get(presenceStatusKey(userId))) as OnlineStatus | null;
    return value ?? 'offline';
  }

  /** Batch status lookup preserving input order (one round-trip). */
  async getStatuses(userIds: readonly string[]): Promise<Record<string, OnlineStatus>> {
    const out: Record<string, OnlineStatus> = {};
    if (userIds.length === 0) {
      return out;
    }
    const keys = userIds.map((id) => presenceStatusKey(id));
    const values = await this.redis.mget(keys);
    userIds.forEach((id, i) => {
      out[id] = (values[i] as OnlineStatus | null) ?? 'offline';
    });
    return out;
  }

  /** Whether the user currently has a live, reachable presence. */
  async isOnline(userId: string): Promise<boolean> {
    const status = await this.getStatus(userId);
    return ONLINE_STATUSES.has(status);
  }

  /**
   * Registers a relay handler for presence transitions and ensures the shared
   * subscriber connection is listening. Returns an unsubscribe function.
   */
  onPresenceEvent(handler: PresenceEventHandler): () => void {
    this.handlers.add(handler);
    void this.ensureSubscribed();
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Publishes a presence transition for cluster-wide consumption. */
  private async publish(userId: string, status: OnlineStatus): Promise<void> {
    const payload: PresencePayload = { userId, status };
    try {
      await this.redis.publish(PRESENCE_CHANNEL, JSON.stringify(payload));
    } catch (err) {
      this.logger.warn(`Failed to publish presence for ${userId}: ${asMessage(err)}`);
    }
  }

  /** Lazily opens the dedicated subscriber and wires message dispatch. */
  private async ensureSubscribed(): Promise<void> {
    if (this.subscriber) {
      return;
    }
    // A subscriber connection cannot run normal commands, so duplicate.
    const sub = this.redis.duplicate();
    this.subscriber = sub;
    sub.on('error', (err: Error) => this.logger.error(`Presence subscriber error: ${err.message}`));
    sub.on('message', (channel: string, message: string) => {
      if (channel !== PRESENCE_CHANNEL) {
        return;
      }
      const payload = this.parsePayload(message);
      if (!payload) {
        return;
      }
      for (const handler of this.handlers) {
        try {
          handler(payload);
        } catch (err) {
          this.logger.warn(`Presence handler threw: ${asMessage(err)}`);
        }
      }
    });
    try {
      await sub.subscribe(PRESENCE_CHANNEL);
    } catch (err) {
      this.logger.error(`Failed to subscribe to presence channel: ${asMessage(err)}`);
    }
  }

  /** Safely parses a published presence payload. */
  private parsePayload(message: string): PresencePayload | null {
    try {
      const parsed = JSON.parse(message) as Partial<PresencePayload>;
      if (typeof parsed.userId === 'string' && typeof parsed.status === 'string') {
        return { userId: parsed.userId, status: parsed.status as OnlineStatus };
      }
    } catch {
      // ignore malformed payloads
    }
    return null;
  }

  /** Closes the subscriber connection on shutdown (shared client owned elsewhere). */
  async onApplicationShutdown(): Promise<void> {
    if (this.subscriber) {
      try {
        await this.subscriber.quit();
      } catch (err) {
        this.logger.warn(`Error closing presence subscriber: ${asMessage(err)}`);
      }
    }
  }
}

/** Narrows an unknown thrown value to a printable message. */
function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Lua: INCR the connection counter and (re-)arm its TTL atomically, returning
 * the new count. KEYS[1]=conn counter, ARGV[1]=ttl seconds. The TTL is re-armed
 * on every connect so an active user's counter never lapses.
 */
const CONN_INCR_LUA = `
local n = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[1])
return n
`;

/**
 * Lua: DECR the connection counter, deleting it once it hits zero, returning the
 * resulting count (clamped at 0). KEYS[1]=conn counter. Atomic so two racing
 * disconnects can't both observe the →0 edge.
 */
const CONN_DECR_LUA = `
local n = redis.call('DECR', KEYS[1])
if n <= 0 then
  redis.call('DEL', KEYS[1])
  return 0
end
return n
`;

/**
 * Lua: re-arm the connection counter's TTL ONLY if it still exists, so a
 * heartbeat never resurrects a key for a fully-disconnected user. KEYS[1]=conn
 * counter, ARGV[1]=ttl seconds.
 */
const CONN_TOUCH_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return 1
`;
