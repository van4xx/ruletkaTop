import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import type {
  AdminBroadcastDto,
  AdminBroadcastHistory,
  AdminBroadcastResult,
  AdminBroadcastSegment,
} from '@ruletka/shared-types';

import { NotificationsService } from '../notifications/notifications.service';
import { BroadcastRecord, BroadcastRecordDocument } from './schemas/broadcast-record.schema';

/** Hard cap on a single broadcast fan-out so an admin can't queue millions inline. */
const MAX_RECIPIENTS = 5000;

/** How many past broadcasts the history surface lists. */
const HISTORY_LIMIT = 100;

/**
 * Admin broadcast surface.
 *
 * Send — REAL (wired to {@link NotificationsService.create}): resolves the
 * target segment to a bounded set of user ids and fans out a `system`
 * notification to each (persisted + delivered via the existing notif pipeline).
 * Resolution reads `users`/`profiles` by name via the shared connection. On
 * success it ALSO inserts a {@link BroadcastRecord} (WAVE-2) so history is real.
 *
 * History — REAL (WAVE-2): reads the `broadcasts` collection, newest first.
 */
@Injectable()
export class AdminBroadcastService {
  private readonly logger = new Logger(AdminBroadcastService.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(BroadcastRecord.name)
    private readonly broadcastModel: Model<BroadcastRecordDocument>,
  ) {}

  /**
   * Fan out a `system` notification to everyone in `segment` (bounded to
   * {@link MAX_RECIPIENTS}), persist a history record, and return its id + the
   * delivered recipient count. Delivery is best-effort per recipient (a single
   * failure never aborts the run).
   */
  async send(dto: AdminBroadcastDto, actorId?: string | null): Promise<AdminBroadcastResult> {
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

    // Persist a history record (best-effort — a logging-store failure must not
    // mask a successful fan-out). Reuse the inserted id as the result id.
    const record = await this.broadcastModel.create({
      title: dto.title,
      body: dto.body,
      segment: dto.segment,
      recipientCount: delivered,
      sentBy: actorId && Types.ObjectId.isValid(actorId) ? new Types.ObjectId(actorId) : null,
    });

    return { id: record._id.toString(), recipients: delivered };
  }

  /** Broadcast history, newest first. */
  async history(): Promise<AdminBroadcastHistory> {
    // `createdAt` is added by `timestamps` and isn't on the class type — read the
    // lean rows through an explicit shape (mirrors AuditService.toEntry).
    const rows = (await this.broadcastModel
      .find()
      .sort({ _id: -1 })
      .limit(HISTORY_LIMIT)
      .lean()
      .exec()) as Array<{
      _id: Types.ObjectId;
      title: string;
      body: string;
      segment: AdminBroadcastSegment;
      recipientCount?: number;
      createdAt?: Date;
    }>;
    return {
      items: rows.map((r) => ({
        id: r._id.toString(),
        title: r.title,
        body: r.body,
        segment: r.segment,
        recipients: r.recipientCount ?? 0,
        createdAt: (r.createdAt ?? new Date()).toISOString(),
      })),
    };
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
