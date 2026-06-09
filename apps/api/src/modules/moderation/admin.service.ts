import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Redis } from 'ioredis';
import { Connection, Model, Types } from 'mongoose';

import { runAccountTeardown } from '../../common/account-teardown';
import {
  PAYMENTS_CANCEL_PORT,
  type PaymentsCancelPort,
} from '../../common/payments-cancel.port';
import { MetricsService } from '../../observability/metrics.service';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { AuditService } from '../admin/audit.service';
import { AuthService } from '../auth/auth.service';
import { FingerprintService } from '../auth/fingerprint.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { USER_DISCONNECT_CHANNEL } from './moderation.constants';

/** Outcome of a ban/unban operation, surfaced to the moderator. */
export interface BanResult {
  userId: string;
  isBanned: boolean;
}

/** Cursor pagination input for the admin ban-list reads (bounded by the caller). */
export interface BanListQuery {
  cursor?: string;
  limit: number;
}

/** One banned account as surfaced to the moderation console. */
export interface BannedUserRow {
  id: string;
  email: string;
  nickname: string;
  /** When the account was banned, if known. We do not store an explicit ban
   * timestamp on `User`, so this falls back to the row's `updatedAt` (the ban
   * write is the most recent mutation in the overwhelming majority of cases). */
  bannedAt: string | null;
  /** Free-text ban reason captured at ban time (`null` if none was recorded). */
  reason: string | null;
  createdAt: string;
}

/** One ban-evasion fingerprint row as surfaced to admins. */
export interface BannedFingerprintRow {
  id: string;
  /** SHA-256 hex of (IP + '|' + User-Agent). Opaque — carries no raw PII. */
  fingerprint: string;
  /** The account whose ban created/last-touched this row. */
  userId: string;
  /** `null` = permanent (never auto-expires). */
  expiresAt: string | null;
  createdAt: string | null;
}

/** A generic cursor page (mirrors the shared `{ items, nextCursor, hasMore }`). */
export interface AdminPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
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
    @InjectConnection() private readonly connection: Connection,
    @Inject(forwardRef(() => AuthService)) private readonly authService: AuthService,
    @Inject(forwardRef(() => FingerprintService))
    private readonly fingerprintService: FingerprintService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly auditService: AuditService,
    // Best-effort upstream billing cancel for a ban (a banned user must not keep
    // being billed). Optional so the module wires up even where CloudPayments
    // isn't bound; absent ⇒ the LOCAL terminal-state drive still runs.
    @Optional()
    @Inject(PAYMENTS_CANCEL_PORT)
    private readonly paymentsCancelPort?: PaymentsCancelPort,
    // OBSERVABILITY (emit-only): durable ban/unban counters (abuse-enforcement
    // volume). Optional so focused unit tests instantiate without wiring it; the
    // emit is best-effort and NEVER affects the sanction.
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /**
   * Ban a user: flip `isBanned` (recording an optional `reason`), record their
   * device/IP fingerprints for ban-evasion, revoke every refresh session, then
   * best-effort force-disconnect their live sockets. Idempotent — re-banning an
   * already banned user re-runs each step (defensive) and still succeeds.
   *
   * `reason` (when provided) is persisted to `user.banReason` so the moderation
   * console can show WHY an account was banned (e.g. "Upheld abuse report"); a
   * re-ban with a new reason overwrites the prior one, and an omitted reason
   * leaves any existing reason untouched (so the AI-escalation ban path, which
   * passes none, doesn't blank a reason a moderator set).
   *
   * Fingerprints are harvested from the user's refresh sessions, so this MUST
   * run before any session teardown (the current `revokeAllSessions` only soft-
   * revokes rows, but recording first keeps us correct if that ever hard-deletes).
   */
  async banUser(userId: string, reason?: string, callerId?: string | null): Promise<BanResult> {
    const updated = await this.setBanned(userId, true, reason);
    await this.fingerprintService.recordForUser(userId);
    await this.authService.revokeAllSessions(userId);
    await this.forceDisconnect(userId);
    // REVERSIBLE billing/feed teardown for the ban: force-cancel the subscription
    // (a banned user must not keep being billed) and expire any active paid Top
    // placement so their promotion stops showing immediately — but LEAVE the
    // wallet intact (an unban restores the account). Best-effort: a teardown
    // hiccup must NEVER abort the ban (steps above already make it effective).
    await runAccountTeardown(this.connection, updated._id, 'ban', {
      onWarn: (m) => this.logger.warn(m),
      cancelUpstream: this.paymentsCancelPort
        ? (subscriptionId) => this.paymentsCancelPort!.cancelSubscription(subscriptionId)
        : undefined,
    }).catch((err: unknown) =>
      this.logger.warn(`banUser: account teardown failed for ${userId}: ${(err as Error).message}`),
    );
    // Append the privileged sanction to the audit trail (best-effort; never fails
    // the ban). `callerId` is the acting moderator for a manual/report/review ban,
    // or `null` for the AI-escalation path (no human actor).
    await this.auditService.log({
      actorId: callerId ?? null,
      action: 'user.ban',
      targetType: 'user',
      targetId: userId,
      meta: { reason: reason ?? null },
    });
    // Count the sanction (abuse-enforcement volume). Best-effort: a metrics blip
    // must never affect the ban (already effective via the steps above).
    this.emitMetric((m) => m.banApplied());
    return { userId: updated._id.toString(), isBanned: updated.isBanned };
  }

  /**
   * Unban a user: clear `isBanned`. Sessions are NOT restored (login afresh).
   *
   * Also CLEARS the user's ban-evasion fingerprints (the inverse of the ban-time
   * {@link FingerprintService.recordForUser}). Without this, an exonerated
   * account would clear `isBanned` yet stay silently locked out of
   * register/login by the lingering fingerprint row matching the gate. The clear
   * is best-effort (it never throws) and is recorded as its own `fingerprint.clear`
   * audit action so the reversal stays attributable.
   */
  async unbanUser(userId: string, callerId?: string | null): Promise<BanResult> {
    const updated = await this.setBanned(userId, false);
    // Lift the ban-evasion fingerprints so the cleared account is not stranded at
    // register/login. Best-effort (swallows its own errors); the unban above is
    // already effective via `isBanned`.
    await this.fingerprintService.clearForUser(userId);
    await this.auditService.log({
      actorId: callerId ?? null,
      action: 'fingerprint.clear',
      targetType: 'user',
      targetId: userId,
    });
    // Best-effort audit row (never fails the unban). `callerId` is the acting
    // moderator, or `null` for the AI false-positive reversal path (no human actor).
    await this.auditService.log({
      actorId: callerId ?? null,
      action: 'user.unban',
      targetType: 'user',
      targetId: userId,
    });
    // Count the lift (best-effort; never affects the unban).
    this.emitMetric((m) => m.banLifted());
    return { userId: updated._id.toString(), isBanned: updated.isBanned };
  }

  // ── Ban-list reads (moderation console) ──────────────────────────────────────

  /**
   * Cursor-paginated list of currently-banned accounts (`isBanned === true`),
   * newest first (`_id` desc). Reads the `users` collection (source of truth for
   * ban state) and batch-joins `profiles` for the display `nickname` in ONE `$in`
   * query — the same read-by-name + batched-join pattern {@link AdminUsersService}
   * uses, so this stays free of a hard profiles-module dependency.
   *
   * `bannedAt` is best-effort: `User` has no dedicated ban timestamp, so we
   * surface `updatedAt` (the ban write is normally the most recent mutation).
   * `reason` reflects `user.banReason` (the free-text reason captured at ban
   * time), or `null` when none was recorded.
   */
  async listBannedUsers(pagination: BanListQuery): Promise<AdminPage<BannedUserRow>> {
    const filter: Record<string, unknown> = { isBanned: true };
    if (pagination.cursor) {
      if (!Types.ObjectId.isValid(pagination.cursor)) {
        return { items: [], nextCursor: null, hasMore: false };
      }
      filter._id = { $lt: new Types.ObjectId(pagination.cursor) };
    }

    const rows = (await this.userModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(pagination.limit + 1)
      .select({ email: 1, banReason: 1, createdAt: 1, updatedAt: 1 })
      .lean()
      .exec()) as unknown as Array<{
      _id: Types.ObjectId;
      email: string;
      banReason?: string | null;
      createdAt?: Date;
      updatedAt?: Date;
    }>;

    const hasMore = rows.length > pagination.limit;
    const page = hasMore ? rows.slice(0, pagination.limit) : rows;

    const nicknames = await this.loadNicknames(page.map((r) => r._id));
    const items: BannedUserRow[] = page.map((row) => ({
      id: row._id.toString(),
      email: row.email,
      nickname: nicknames.get(row._id.toString()) ?? '',
      bannedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
      reason: row.banReason ?? null,
      createdAt: row.createdAt ? row.createdAt.toISOString() : new Date(0).toISOString(),
    }));

    const last = page.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? last._id.toString() : null,
      hasMore,
    };
  }

  /**
   * Cursor-paginated list of ban-evasion fingerprints (the `bannedfingerprints`
   * collection), newest first. That collection's Mongoose model is owned by the
   * `AuthModule` and is NOT in this module's injector, so we read it through the
   * shared {@link Connection} by collection name (same escape hatch
   * {@link AdminUsersService} uses for `profiles`). We only ever expose the hash,
   * never any raw IP/UA (the collection stores none).
   *
   * NOTE: the register/login fingerprint gate is disabled by default
   * (`FINGERPRINT_BAN_ENABLED`), but historical rows still accumulate here, so
   * admins must be able to inspect and clear them.
   */
  async listBannedFingerprints(pagination: BanListQuery): Promise<AdminPage<BannedFingerprintRow>> {
    const filter: Record<string, unknown> = {};
    if (pagination.cursor) {
      if (!Types.ObjectId.isValid(pagination.cursor)) {
        return { items: [], nextCursor: null, hasMore: false };
      }
      filter._id = { $lt: new Types.ObjectId(pagination.cursor) };
    }

    const docs = (await this.connection
      .collection('bannedfingerprints')
      .find(filter, {
        projection: { fingerprint: 1, userId: 1, expiresAt: 1, createdAt: 1 },
      })
      .sort({ _id: -1 })
      .limit(pagination.limit + 1)
      .toArray()) as unknown as Array<{
      _id: Types.ObjectId;
      fingerprint: string;
      userId?: Types.ObjectId;
      expiresAt?: Date | null;
      createdAt?: Date;
    }>;

    const hasMore = docs.length > pagination.limit;
    const page = hasMore ? docs.slice(0, pagination.limit) : docs;

    const items: BannedFingerprintRow[] = page.map((doc) => ({
      id: doc._id.toString(),
      fingerprint: doc.fingerprint,
      userId: doc.userId ? doc.userId.toString() : '',
      expiresAt: doc.expiresAt ? doc.expiresAt.toISOString() : null,
      createdAt: doc.createdAt ? doc.createdAt.toISOString() : null,
    }));

    const last = page.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? last._id.toString() : null,
      hasMore,
    };
  }

  /**
   * Lift (delete) a single ban-evasion fingerprint row by its `_id`. Admin-only
   * (gated in the controller). 404s an unknown/invalid id so the console can show
   * a precise error rather than silently succeeding on a stale row.
   */
  async liftFingerprint(
    id: string,
    callerId?: string | null,
  ): Promise<{ id: string; deleted: true }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Fingerprint not found');
    }
    const result = await this.connection
      .collection('bannedfingerprints')
      .deleteOne({ _id: new Types.ObjectId(id) });
    if (result.deletedCount === 0) {
      throw new NotFoundException('Fingerprint not found');
    }
    // Best-effort audit row (never fails the lift). Records which moderator
    // cleared which ban-evasion fingerprint.
    await this.auditService.log({
      actorId: callerId ?? null,
      action: 'fingerprint.lift',
      targetType: 'fingerprint',
      targetId: id,
    });
    return { id, deleted: true };
  }

  /**
   * Batch-load `userId → nickname` from `profiles` in ONE `$in` query. Missing
   * profiles fall back to an empty nickname in the caller.
   */
  private async loadNicknames(userIds: readonly Types.ObjectId[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (userIds.length === 0) {
      return out;
    }
    const docs = await this.connection
      .collection('profiles')
      .find(
        { userId: { $in: userIds as Types.ObjectId[] } },
        { projection: { userId: 1, nickname: 1 } },
      )
      .toArray();
    for (const doc of docs) {
      const p = doc as unknown as { userId: Types.ObjectId; nickname?: string };
      out.set(p.userId.toString(), p.nickname ?? '');
    }
    return out;
  }

  /**
   * Set the ban flag on a user or 404 if no such account. When banning, an
   * optional `reason` is persisted to `banReason`; unbanning clears the reason.
   * A ban with no `reason` leaves any existing reason untouched (the field is
   * only written when we have something to write or are clearing it on unban).
   */
  private async setBanned(
    userId: string,
    isBanned: boolean,
    reason?: string,
  ): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }
    const update: Record<string, unknown> = { isBanned };
    if (!isBanned) {
      // Clear the reason on unban so a stale reason never lingers on an active account.
      update.banReason = null;
    } else if (reason && reason.trim().length > 0) {
      update.banReason = reason.trim();
    }
    const updated = await this.userModel
      .findByIdAndUpdate(new Types.ObjectId(userId), { $set: update }, { new: true })
      .exec();
    if (!updated) {
      throw new NotFoundException('User not found');
    }
    return updated;
  }

  /**
   * Best-effort metric emit. Wraps the (optional) MetricsService so a counter
   * bump can NEVER throw into a sanction flow (the ban/unban is authoritative,
   * the metric is a side-effect). No-op when MetricsService isn't wired.
   */
  private emitMetric(fn: (m: MetricsService) => void): void {
    if (!this.metrics) {
      return;
    }
    try {
      fn(this.metrics);
    } catch {
      // a metrics blip must never affect the sanction
    }
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
