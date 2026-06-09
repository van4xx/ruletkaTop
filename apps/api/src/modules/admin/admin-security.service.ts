import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

import type {
  AdminSecurityEvent,
  AdminSecurityEventList,
  AdminSession,
  AdminSessionList,
} from '@ruletka/shared-types';

/** How many recent sessions the security surface lists. */
const SESSION_LIMIT = 50;

/** How many rows to pull from EACH security-event source before merging. */
const EVENT_SOURCE_LIMIT = 50;

/** Final size of the merged, time-sorted security-events feed. */
const EVENT_FEED_LIMIT = 80;

/** A `sessions` row as read for the security surface. */
interface SessionRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  ip?: string | null;
  userAgent?: string | null;
  device?: string | null;
  expiresAt?: Date;
  revokedAt?: Date | null;
  createdAt?: Date;
}

/** A `users` row as read for the (banned-user) events source. */
interface BannedUserRow {
  _id: Types.ObjectId;
  email?: string | null;
  role?: string | null;
  updatedAt?: Date;
}

/** A `bannedfingerprints` row as read for the (fingerprint-ban) events source. */
interface BannedFingerprintRow {
  _id: Types.ObjectId;
  fingerprint?: string | null;
  userId?: Types.ObjectId | null;
  expiresAt?: Date | null;
  createdAt?: Date;
}

/** An `auditlogs` row as read for the (login-lockout) events source. */
interface AuditLogRow {
  _id: Types.ObjectId;
  action?: string | null;
  meta?: { email?: string | null; ip?: string | null; count?: number | null } | null;
  createdAt?: Date;
}

/** An internal, pre-serialisation event carrying its real sort timestamp. */
interface InternalEvent {
  id: string;
  type: AdminSecurityEvent['type'];
  userId: string | null;
  detail: string;
  at: Date;
}

/**
 * Admin security surface.
 *
 * Sessions — REAL: reads the auth `sessions` collection (one row per issued
 * refresh token) by name via the shared connection. Surfaces the newest
 * sessions with their client context (ip/ua/device) and a live-session count
 * (neither expired nor revoked). The token hash itself is never read.
 *
 * Events — REAL (WAVE-2 + observability pass): a unified, time-sorted security
 * feed aggregated from existing collections WITHOUT touching any other module.
 * Four real signals:
 *  - `user.banned`        — `users` where `isBanned`, by `updatedAt` desc;
 *  - `fingerprint.banned` — `bannedfingerprints` (ban-evasion), by `createdAt`;
 *  - `session.revoked`    — `sessions` where `revokedAt != null` (logout / token
 *                           reuse-detection revocation), by `revokedAt` desc;
 *  - `auth.login.locked`  — `admin_audit_logs` rows the auth service writes when
 *                           a failed-login identity crosses the lockout threshold
 *                           (brute-force / credential-stuffing signal), by
 *                           `createdAt` desc. The audit collection is read by
 *                           name (no AuditService import), and the lockout `meta`
 *                           carries email/ip but no userId, so `userId` is null.
 * Each source is bounded, then merged + sorted newest-first into the contract
 * shape (`{ id, type, userId, detail, createdAt }`).
 */
@Injectable()
export class AdminSecurityService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** The newest sessions + the count of currently-live ones. */
  async listSessions(): Promise<AdminSessionList> {
    const sessions = this.connection.collection('sessions');
    const now = new Date();

    const [rows, activeCount] = await Promise.all([
      sessions
        .find(
          {},
          {
            projection: {
              userId: 1,
              ip: 1,
              userAgent: 1,
              device: 1,
              expiresAt: 1,
              revokedAt: 1,
              createdAt: 1,
            },
          },
        )
        .sort({ _id: -1 })
        .limit(SESSION_LIMIT)
        .toArray() as unknown as Promise<SessionRow[]>,
      sessions.countDocuments({ revokedAt: null, expiresAt: { $gt: now } }),
    ]);

    const items: AdminSession[] = rows.map((r) => {
      const expiresAt = r.expiresAt ?? now;
      const revoked = r.revokedAt != null;
      return {
        id: r._id.toString(),
        userId: r.userId.toString(),
        ip: r.ip ?? null,
        userAgent: r.userAgent ?? null,
        device: r.device ?? null,
        createdAt: (r.createdAt ?? now).toISOString(),
        expiresAt: expiresAt.toISOString(),
        revoked,
      };
    });

    return { items, activeCount };
  }

  /**
   * A unified, newest-first security-events feed merged from three real sources
   * (banned users, banned fingerprints, revoked sessions). Each source is read
   * by name via the shared connection (no cross-module imports).
   */
  async listEvents(): Promise<AdminSecurityEventList> {
    const [bannedUsers, bannedFps, revokedSessions, loginLockouts] = await Promise.all([
      this.bannedUserEvents(),
      this.bannedFingerprintEvents(),
      this.revokedSessionEvents(),
      this.loginLockoutEvents(),
    ]);

    const merged = [...bannedUsers, ...bannedFps, ...revokedSessions, ...loginLockouts]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, EVENT_FEED_LIMIT);

    const items: AdminSecurityEvent[] = merged.map((e) => ({
      id: e.id,
      type: e.type,
      userId: e.userId,
      detail: e.detail,
      createdAt: e.at.toISOString(),
    }));

    return { items };
  }

  // ── event sources ──────────────────────────────────────────────────────────

  /** Recently banned accounts (`users.isBanned = true`), by `updatedAt` desc. */
  private async bannedUserEvents(): Promise<InternalEvent[]> {
    const rows = (await this.connection
      .collection('users')
      .find({ isBanned: true }, { projection: { email: 1, role: 1, updatedAt: 1 } })
      .sort({ updatedAt: -1 })
      .limit(EVENT_SOURCE_LIMIT)
      .toArray()) as unknown as BannedUserRow[];

    return rows.map((r) => ({
      id: r._id.toString(),
      type: 'user.banned',
      userId: r._id.toString(),
      detail: `Аккаунт заблокирован${r.email ? ` — ${r.email}` : ''}${r.role ? ` (${r.role})` : ''}`,
      at: r.updatedAt ?? new Date(0),
    }));
  }

  /** Active banned fingerprints (ban-evasion), by `createdAt` desc. */
  private async bannedFingerprintEvents(): Promise<InternalEvent[]> {
    const rows = (await this.connection
      .collection('bannedfingerprints')
      .find({}, { projection: { fingerprint: 1, userId: 1, expiresAt: 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .limit(EVENT_SOURCE_LIMIT)
      .toArray()) as unknown as BannedFingerprintRow[];

    return rows.map((r) => {
      const short = (r.fingerprint ?? '').slice(0, 12);
      const expiry = r.expiresAt ? `до ${r.expiresAt.toISOString().slice(0, 10)}` : 'бессрочно';
      return {
        id: r._id.toString(),
        type: 'fingerprint.banned',
        userId: r.userId ? r.userId.toString() : null,
        detail: `Бан по отпечатку ${short}… (${expiry})`,
        at: r.createdAt ?? new Date(0),
      };
    });
  }

  /** Revoked sessions (logout / reuse-detection), by `revokedAt` desc. */
  private async revokedSessionEvents(): Promise<InternalEvent[]> {
    const rows = (await this.connection
      .collection('sessions')
      .find(
        { revokedAt: { $ne: null } },
        { projection: { userId: 1, ip: 1, device: 1, userAgent: 1, revokedAt: 1 } },
      )
      .sort({ revokedAt: -1 })
      .limit(EVENT_SOURCE_LIMIT)
      .toArray()) as unknown as SessionRow[];

    return rows.map((r) => {
      const where = r.ip ?? r.device ?? r.userAgent ?? null;
      return {
        id: r._id.toString(),
        type: 'session.revoked',
        userId: r.userId ? r.userId.toString() : null,
        detail: `Сессия отозвана${where ? ` — ${where}` : ''}`,
        at: r.revokedAt ?? new Date(0),
      };
    });
  }

  /**
   * Failed-login LOCKOUTS, sourced from the append-only audit collection
   * (`admin_audit_logs`) where the auth service stamped `auth.login.locked` after
   * an identity crossed the brute-force threshold. Read by name via the shared
   * connection (no AuditService dependency); the `{ action: 1, _id: -1 }` index
   * on that collection keeps the filtered, time-ordered read cheap. The lockout
   * `meta` carries email + ip but no userId, so `userId` is null. Newest first.
   */
  private async loginLockoutEvents(): Promise<InternalEvent[]> {
    const rows = (await this.connection
      .collection('admin_audit_logs')
      .find(
        { action: 'auth.login.locked' },
        { projection: { meta: 1, createdAt: 1 } },
      )
      .sort({ _id: -1 })
      .limit(EVENT_SOURCE_LIMIT)
      .toArray()) as unknown as AuditLogRow[];

    return rows.map((r) => {
      const email = r.meta?.email ?? null;
      const ip = r.meta?.ip ?? null;
      const where = [email, ip].filter(Boolean).join(' / ');
      return {
        id: r._id.toString(),
        type: 'auth.login.locked',
        // The lockout is keyed by email+IP, not a user account — no userId.
        userId: null,
        detail: `Блокировка входа (брутфорс)${where ? ` — ${where}` : ''}`,
        at: r.createdAt ?? new Date(0),
      };
    });
  }
}
