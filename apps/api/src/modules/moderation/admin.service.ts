import { Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Redis } from 'ioredis';
import { Model, Types } from 'mongoose';

import { REDIS_CLIENT } from '../../redis/redis.constants';
import { AuthService } from '../auth/auth.service';
import { FingerprintService } from '../auth/fingerprint.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { USER_DISCONNECT_CHANNEL } from './moderation.constants';

/** Outcome of a ban/unban operation, surfaced to the moderator. */
export interface BanResult {
  userId: string;
  isBanned: boolean;
}

/**
 * Administrative account actions (role-guarded in the controller): banning and
 * unbanning users.
 *
 * Banning is layered defence:
 *  1. set `user.isBanned = true` (login + refresh already reject banned
 *     accounts, and gateways re-validate `isBanned` on the next event);
 *  2. revoke ALL refresh sessions via {@link AuthService.revokeAllSessions} so
 *     the account cannot mint new access tokens;
 *  3. best-effort PUBLISH to {@link USER_DISCONNECT_CHANNEL} so the realtime
 *     gateways drop the user's live sockets cluster-wide immediately.
 *
 * The Redis publish is best-effort: a failure is logged but does NOT fail the
 * ban — steps 1–2 already make the ban effective; step 3 only shortens the
 * window before live sockets are dropped.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @Inject(forwardRef(() => AuthService)) private readonly authService: AuthService,
    @Inject(forwardRef(() => FingerprintService))
    private readonly fingerprintService: FingerprintService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Ban a user: flip `isBanned`, record their device/IP fingerprints for
   * ban-evasion, revoke every refresh session, then best-effort force-disconnect
   * their live sockets. Idempotent — re-banning an already banned user re-runs
   * each step (defensive) and still succeeds.
   *
   * Fingerprints are harvested from the user's refresh sessions, so this MUST
   * run before any session teardown (the current `revokeAllSessions` only soft-
   * revokes rows, but recording first keeps us correct if that ever hard-deletes).
   */
  async banUser(userId: string): Promise<BanResult> {
    const updated = await this.setBanned(userId, true);
    await this.fingerprintService.recordForUser(userId);
    await this.authService.revokeAllSessions(userId);
    await this.forceDisconnect(userId);
    return { userId: updated._id.toString(), isBanned: updated.isBanned };
  }

  /** Unban a user: clear `isBanned`. Sessions are NOT restored (login afresh). */
  async unbanUser(userId: string): Promise<BanResult> {
    const updated = await this.setBanned(userId, false);
    return { userId: updated._id.toString(), isBanned: updated.isBanned };
  }

  /** Set the ban flag on a user or 404 if no such account. */
  private async setBanned(userId: string, isBanned: boolean): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }
    const updated = await this.userModel
      .findByIdAndUpdate(
        new Types.ObjectId(userId),
        { $set: { isBanned } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('User not found');
    }
    return updated;
  }

  /**
   * Best-effort cluster-wide socket teardown: publish the banned `userId` so any
   * API node holding their sockets disconnects them. The realtime subscriber
   * (`realtime-security`) treats the message as the RAW userId string, so we
   * publish the bare id (not JSON). Never throws — coordination being unavailable
   * just means we rely on `isBanned` re-validation instead.
   */
  private async forceDisconnect(userId: string): Promise<void> {
    try {
      await this.redis.publish(USER_DISCONNECT_CHANNEL, userId);
    } catch (err) {
      this.logger.warn(
        `Failed to publish socket disconnect for banned user ${userId}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
