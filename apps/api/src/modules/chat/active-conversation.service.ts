import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../redis/redis.constants';

/**
 * TTL (seconds) of a user's "currently-focused conversation" marker.
 *
 * The client refreshes this marker whenever the user is demonstrably looking at
 * a thread (opening it, sending, typing, marking read). Like a presence
 * heartbeat it must comfortably outlive the gap between those signals so a user
 * who is reading (but not yet replying) is still treated as "in" the
 * conversation — while lapsing soon after they navigate away, so a later
 * message correctly produces an in-app notification.
 */
export const ACTIVE_CONVERSATION_TTL_SECONDS = 30;

/** Per-user focus key, e.g. `chat:active:<userId>` → conversationId. */
function activeConversationKey(userId: string): string {
  return `chat:active:${userId}`;
}

/**
 * Tracks, in Redis, the single conversation a user is actively looking at right
 * now (a short-TTL "focus heartbeat"), so chat can decide whether an inbound
 * message warrants an in-app notification.
 *
 * Why a dedicated marker rather than socket rooms: the chat gateway only joins a
 * per-USER room (`user:<id>`) for cross-device / cross-node fan-out — there is
 * no per-conversation room to inspect, and a user can be online (socket up) yet
 * looking at a DIFFERENT thread. This marker captures exactly "is this user
 * focused on THIS conversation", cluster-wide, in one round-trip — mirroring the
 * Redis-key + TTL approach of {@link PresenceService}.
 *
 * All operations are best-effort: a Redis hiccup degrades to "not active"
 * (i.e. we err toward notifying), never throwing into the message path.
 */
@Injectable()
export class ActiveConversationService {
  private readonly logger = new Logger(ActiveConversationService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Record that `userId` is currently focused on `conversationId` and (re-)arm
   * the focus TTL. Called from the gateway on the signals that prove a user is
   * looking at a thread: opening it (read), typing, and sending into it.
   */
  async markActive(userId: string, conversationId: string): Promise<void> {
    try {
      await this.redis.set(
        activeConversationKey(userId),
        conversationId,
        'EX',
        ACTIVE_CONVERSATION_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.debug(`markActive failed for ${userId}: ${asMessage(err)}`);
    }
  }

  /** Clear `userId`'s focus marker (e.g. when they leave/close the thread). */
  async clearActive(userId: string): Promise<void> {
    try {
      await this.redis.del(activeConversationKey(userId));
    } catch (err) {
      this.logger.debug(`clearActive failed for ${userId}: ${asMessage(err)}`);
    }
  }

  /**
   * Whether `userId` is, right now, focused on `conversationId`. A missing /
   * lapsed marker (or any Redis error) yields `false` so the caller treats the
   * user as away and surfaces a notification.
   */
  async isActiveIn(userId: string, conversationId: string): Promise<boolean> {
    try {
      const current = await this.redis.get(activeConversationKey(userId));
      return current === conversationId;
    } catch (err) {
      this.logger.debug(`isActiveIn failed for ${userId}: ${asMessage(err)}`);
      return false;
    }
  }
}

/** Narrows an unknown thrown value to a printable message. */
function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
