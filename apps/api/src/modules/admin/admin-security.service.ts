import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

import type {
  AdminSecurityEventList,
  AdminSession,
  AdminSessionList,
} from '@ruletka/shared-types';

/** How many recent sessions the security surface lists. */
const SESSION_LIMIT = 50;

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

/**
 * Admin security surface.
 *
 * Sessions — REAL: reads the auth `sessions` collection (one row per issued
 * refresh token) by name via the shared connection. Surfaces the newest
 * sessions with their client context (ip/ua/device) and a live-session count
 * (neither expired nor revoked). The token hash itself is never read.
 *
 * Events — STUB: there is no dedicated security-events collection; login locks
 * / reuse-detection are logged but not yet queried into one feed. Returns empty.
 * Wave-2 introduces a security-events stream. // TODO(wave2)
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

  /** STUB — no security-events collection yet. Always empty. // TODO(wave2) */
  async listEvents(): Promise<AdminSecurityEventList> {
    // TODO(wave2): surface login-lock / reuse-detection / ban events as a feed.
    return { items: [] };
  }
}
