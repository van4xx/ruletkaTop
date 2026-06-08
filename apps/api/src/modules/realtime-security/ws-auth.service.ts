import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Connection, Types } from 'mongoose';
import { Redis } from 'ioredis';

import type { JwtPayload } from '@ruletka/shared-types';

import { jwtPayloadSchema } from '../../common/jwt-payload.schema';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { USER_DISCONNECT_CHANNEL } from './realtime-security.constants';

/** Handler invoked with a user id that must be force-disconnected cluster-wide. */
export type DisconnectHandler = (userId: string) => void;

/** Backoff between the first and the (single) retry of a failed ban check. */
const BAN_CHECK_RETRY_DELAY_MS = 150;

/**
 * Shared WebSocket security helper for the realtime gateways.
 *
 * Responsibilities:
 * - {@link verifyToken}: verify a handshake JWT pinned to HS256 AND validate
 *   the decoded payload's shape with Zod (so a token signed with the right
 *   secret but a malformed body is rejected, and `alg: none` / algorithm
 *   confusion can never be honoured);
 * - {@link isBanned}: re-check the account's ban flag on connection (a token
 *   minted before the ban must not grant a live socket);
 * - {@link onDisconnectRequest}: subscribe to the {@link USER_DISCONNECT_CHANNEL}
 *   Redis channel (published by moderation when it bans a user) and fan the id
 *   out to every registered gateway so they can drop that user's sockets.
 *
 * The ban flag is read straight from the `users` collection by name (no hard
 * dependency on the users module), mirroring how {@link ChatService} reads the
 * `settings` collection.
 */
@Injectable()
export class WsAuthService implements OnApplicationShutdown {
  private readonly logger = new Logger(WsAuthService.name);

  /** Lazily-created dedicated SUBSCRIBE connection (Redis requires its own). */
  private subscriber?: Redis;
  /** Per-gateway disconnect handlers fanned out on a ban event. */
  private readonly handlers = new Set<DisconnectHandler>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly jwtService: JwtService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Verify and shape-validate a handshake token. Returns the typed payload, or
   * `null` if the token is missing, fails signature/expiry/algorithm checks, or
   * does not match the {@link JwtPayload} schema. Algorithm is pinned to HS256
   * at the call site (defence-in-depth on top of the module default).
   */
  verifyToken(token: string | undefined | null): JwtPayload | null {
    if (!token) {
      return null;
    }
    let decoded: unknown;
    try {
      decoded = this.jwtService.verify(token, { algorithms: ['HS256'] });
    } catch {
      return null;
    }
    const parsed = jwtPayloadSchema.safeParse(decoded);
    if (!parsed.success) {
      return null;
    }
    return parsed.data;
  }

  /**
   * Whether the account is currently banned. Reads the `users` collection
   * directly. A missing user is treated as banned (their token can no longer
   * correspond to a valid account).
   *
   * SECURITY: this gate decides whether a (possibly banned) account gets a live
   * socket, so on a read error we fail CLOSED — after one brief retry to absorb a
   * transient blip, an unresolved read returns `true` (deny). Failing OPEN here
   * would let a banned user reconnect during any DB hiccup, which is exactly the
   * window enforcement must not have.
   */
  async isBanned(userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) {
      return true;
    }
    const objectId = new Types.ObjectId(userId);
    const readOnce = async (): Promise<boolean> => {
      const doc = await this.connection
        .collection('users')
        .findOne({ _id: objectId }, { projection: { isBanned: 1 } });
      if (!doc) {
        return true;
      }
      return (doc as { isBanned?: boolean }).isBanned === true;
    };

    try {
      return await readOnce();
    } catch (firstErr) {
      this.logger.warn(
        `isBanned check failed for ${userId}, retrying: ${asMessage(firstErr)}`,
      );
      // One brief retry to ride out a transient blip before failing closed.
      await delay(BAN_CHECK_RETRY_DELAY_MS);
      try {
        return await readOnce();
      } catch (retryErr) {
        // Fail CLOSED: an unresolved ban check denies the socket (treat as banned).
        this.logger.error(
          `isBanned check failed for ${userId} after retry, failing closed (denying): ` +
            asMessage(retryErr),
        );
        return true;
      }
    }
  }

  /**
   * Register a force-disconnect handler and ensure the shared subscriber is
   * listening on {@link USER_DISCONNECT_CHANNEL}. Returns an unsubscribe fn.
   */
  onDisconnectRequest(handler: DisconnectHandler): () => void {
    this.handlers.add(handler);
    void this.ensureSubscribed();
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Lazily opens the dedicated subscriber and wires ban-event dispatch. */
  private async ensureSubscribed(): Promise<void> {
    if (this.subscriber) {
      return;
    }
    // A subscriber connection cannot run normal commands, so duplicate.
    const sub = this.redis.duplicate();
    this.subscriber = sub;
    sub.on('error', (err: Error) =>
      this.logger.error(`Disconnect subscriber error: ${err.message}`),
    );
    sub.on('message', (channel: string, message: string) => {
      if (channel !== USER_DISCONNECT_CHANNEL) {
        return;
      }
      const userId = message.trim();
      if (userId.length === 0) {
        return;
      }
      for (const handler of this.handlers) {
        try {
          handler(userId);
        } catch (err) {
          this.logger.warn(`Disconnect handler threw: ${asMessage(err)}`);
        }
      }
    });
    try {
      await sub.subscribe(USER_DISCONNECT_CHANNEL);
    } catch (err) {
      this.logger.error(`Failed to subscribe to disconnect channel: ${asMessage(err)}`);
    }
  }

  /** Closes the subscriber connection on shutdown (shared client owned elsewhere). */
  async onApplicationShutdown(): Promise<void> {
    if (this.subscriber) {
      try {
        await this.subscriber.quit();
      } catch (err) {
        this.logger.warn(`Error closing disconnect subscriber: ${asMessage(err)}`);
      }
    }
  }
}

/** Narrows an unknown thrown value to a printable message. */
function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Resolve after `ms` milliseconds (used for the single ban-check retry backoff). */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
