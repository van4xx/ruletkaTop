import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

import type {
  AdminBroadcastDto,
  AdminBroadcastHistory,
  AdminBroadcastResult,
  AdminBroadcastSegment,
} from '@ruletka/shared-types';

import { NotificationsService } from '../notifications/notifications.service';

/** Hard cap on a single broadcast fan-out so an admin can't queue millions inline. */
const MAX_RECIPIENTS = 5000;

/**
 * Admin broadcast surface.
 *
 * Send — REAL (wired to {@link NotificationsService.create}): resolves the
 * target segment to a bounded set of user ids and fans out a `system`
 * notification to each (persisted + delivered via the existing notif pipeline).
 * Resolution reads `users`/`profiles` by name via the shared connection.
 *
 * History — STUB: there is no broadcast-records collection yet, so history is
 * empty. Wave-2 persists each send + adds delivery analytics. // TODO(wave2)
 */
@Injectable()
export class AdminBroadcastService {
  private readonly logger = new Logger(AdminBroadcastService.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Fan out a `system` notification to everyone in `segment` (bounded to
   * {@link MAX_RECIPIENTS}). Returns a synthetic record id + the recipient count.
   * Delivery is best-effort per recipient (a single failure never aborts the run).
   */
  async send(dto: AdminBroadcastDto): Promise<AdminBroadcastResult> {
    const userIds = await this.resolveSegment(dto.segment);

    let delivered = 0;
    for (const userId of userIds) {
      try {
        await this.notificationsService.create({
          recipientUserId: userId,
          kind: 'system',
          title: dto.title,
          body: dto.body,
        });
        delivered += 1;
      } catch (err) {
        this.logger.warn(`Broadcast delivery failed for ${userId}: ${(err as Error).message}`);
      }
    }

    // TODO(wave2): persist a broadcast record (title/body/segment/recipients) so
    // GET /admin/broadcast returns real history.
    return { id: new Types.ObjectId().toString(), recipients: delivered };
  }

  /** STUB — no broadcast-records collection yet. Always empty. // TODO(wave2) */
  async history(): Promise<AdminBroadcastHistory> {
    // TODO(wave2): read from a real `broadcasts` collection.
    return { items: [] };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * Resolve a segment to a bounded list of user ids.
   *  - `all` → every account;
   *  - `banned` → `users.isBanned = true`;
   *  - `active` → users seen in the last 30 days (by `lastSeenAt`/`updatedAt`);
   *  - `premium` → `profiles.isPremium = true` (mapped back to userIds).
   */
  private async resolveSegment(segment: AdminBroadcastSegment): Promise<string[]> {
    if (segment === 'premium') {
      const docs = await this.connection
        .collection('profiles')
        .find({ isPremium: true }, { projection: { userId: 1 } })
        .limit(MAX_RECIPIENTS)
        .toArray();
      return docs
        .map((d) => (d as { userId?: Types.ObjectId }).userId)
        .filter((id): id is Types.ObjectId => id != null)
        .map((id) => id.toString());
    }

    const filter: Record<string, unknown> = {};
    if (segment === 'banned') {
      filter.isBanned = true;
    } else if (segment === 'active') {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      // `users` has no canonical lastSeen — approximate with `updatedAt`.
      filter.updatedAt = { $gte: since };
    }

    const docs = await this.connection
      .collection('users')
      .find(filter, { projection: { _id: 1 } })
      .limit(MAX_RECIPIENTS)
      .toArray();
    return docs.map((d) => d._id.toString());
  }
}
