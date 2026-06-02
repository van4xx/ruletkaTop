import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { BannedFingerprint, BannedFingerprintDocument } from './schemas/banned-fingerprint.schema';
import { Session, SessionDocument } from './schemas/session.schema';

/** Best-effort client context a fingerprint is computed from. */
export interface FingerprintContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Ban-evasion fingerprinting.
 *
 * A "fingerprint" is a stable SHA-256 hex of the caller's IP + User-Agent — a
 * coarse device/network signal (intentionally not a precise device id; it just
 * raises the cost of trivially re-registering from the same browser/IP after a
 * ban). We persist only the hash, never the raw IP/UA.
 *
 * Coordination with moderation: the ban itself stays owned by the moderation
 * `AdminService` (it flips `User.isBanned`, revokes refresh sessions, and
 * publishes the socket-disconnect). This service does NOT duplicate ban logic —
 * it only ASSOCIATES fingerprints with a banned account. {@link recordForUser}
 * is called from the ban flow; it harvests the fingerprints already captured on
 * the banned user's persisted refresh {@link Session} rows (each stores `ip` +
 * `userAgent`) so we don't need a new capture path, plus an optional explicit
 * context.
 *
 * The register/login gate calls {@link isBanned} with the request context; an
 * ACTIVE matching row rejects the attempt.
 */
@Injectable()
export class FingerprintService {
  private readonly logger = new Logger(FingerprintService.name);

  constructor(
    @InjectModel(BannedFingerprint.name)
    private readonly bannedFingerprintModel: Model<BannedFingerprintDocument>,
    @InjectModel(Session.name)
    private readonly sessionModel: Model<SessionDocument>,
  ) {}

  /**
   * Compute the stable fingerprint hash for a request context, or `null` when
   * there is too little signal (no IP AND no User-Agent) to form a meaningful
   * fingerprint — callers must treat `null` as "cannot fingerprint" and skip the
   * gate rather than banning everyone with an empty fingerprint.
   */
  compute(ctx: FingerprintContext): string | null {
    const ip = (ctx.ip ?? '').trim();
    const userAgent = (ctx.userAgent ?? '').trim();
    if (ip.length === 0 && userAgent.length === 0) {
      return null;
    }
    return createHash('sha256').update(`${ip}|${userAgent}`).digest('hex');
  }

  /**
   * Whether the supplied context matches an ACTIVE banned fingerprint.
   *
   * Returns `false` when the context can't be fingerprinted (insufficient
   * signal) or on any storage error (fail OPEN — a DB blip must not lock
   * legitimate users out of register/login; `User.isBanned` remains the
   * authoritative gate).
   */
  async isBanned(ctx: FingerprintContext): Promise<boolean> {
    const fingerprint = this.compute(ctx);
    if (!fingerprint) {
      return false;
    }
    try {
      const now = new Date();
      const row = await this.bannedFingerprintModel
        .findOne({
          fingerprint,
          // Active = permanent (null) OR not-yet-expired.
          $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
        })
        .lean()
        .exec();
      return row !== null;
    } catch (err) {
      this.logger.warn(`Fingerprint ban check failed: ${asMessage(err)}`);
      return false;
    }
  }

  /**
   * Associate every fingerprint seen on a (just-)banned user's refresh sessions
   * — plus an optional explicit current context — with that user, so future
   * register/login attempts from the same device/IP are blocked.
   *
   * `expiresAt` mirrors any temporary-ban expiry (pass `null`/omit for a
   * permanent fingerprint ban). Idempotent: upserts by fingerprint and refreshes
   * the expiry/owner. Best-effort — never throws (the ban is already effective
   * via `isBanned` + session revocation regardless).
   */
  async recordForUser(
    userId: string,
    options: { expiresAt?: Date | null; context?: FingerprintContext } = {},
  ): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      return;
    }
    const expiresAt = options.expiresAt ?? null;
    try {
      const fingerprints = await this.collectFingerprints(userId, options.context);
      if (fingerprints.size === 0) {
        return;
      }
      const objectId = new Types.ObjectId(userId);
      await Promise.all(
        [...fingerprints].map((fingerprint) =>
          this.bannedFingerprintModel
            .updateOne({ fingerprint }, { $set: { userId: objectId, expiresAt } }, { upsert: true })
            .exec(),
        ),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to record ban-evasion fingerprints for ${userId}: ${asMessage(err)}`,
      );
    }
  }

  /**
   * Gather the distinct fingerprint hashes for a user from their persisted
   * refresh sessions (which store `ip` + `userAgent`) plus the optional current
   * request context.
   */
  private async collectFingerprints(
    userId: string,
    context?: FingerprintContext,
  ): Promise<Set<string>> {
    const fingerprints = new Set<string>();

    const fromContext = context ? this.compute(context) : null;
    if (fromContext) {
      fingerprints.add(fromContext);
    }

    const sessions = await this.sessionModel
      .find({ userId: new Types.ObjectId(userId) })
      .select('ip userAgent')
      .lean()
      .exec();
    for (const session of sessions) {
      const fp = this.compute({ ip: session.ip, userAgent: session.userAgent });
      if (fp) {
        fingerprints.add(fp);
      }
    }
    return fingerprints;
  }
}

/** Narrows an unknown thrown value to a printable message. */
function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
