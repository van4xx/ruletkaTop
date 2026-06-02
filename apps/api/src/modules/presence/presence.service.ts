import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import type { OnlineStatus, PresencePayload } from '@ruletka/shared-types';

import { REDIS_CLIENT } from '../../redis/redis.constants';
import {
  DEFAULT_PRESENCE_TTL_SECONDS,
  PRESENCE_CHANNEL,
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
    this.ttlSeconds = config.get<number>(
      'PRESENCE_TTL_SECONDS',
      DEFAULT_PRESENCE_TTL_SECONDS,
    );
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
    sub.on('error', (err: Error) =>
      this.logger.error(`Presence subscriber error: ${err.message}`),
    );
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
