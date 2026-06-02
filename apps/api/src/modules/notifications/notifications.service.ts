import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Redis } from 'ioredis';
import { Model, type QueryFilter, Types } from 'mongoose';

import type {
  AppNotification,
  ListNotificationsQuery,
  Notification as NotificationContract,
  NotificationKind,
} from '@ruletka/shared-types';

import { MetricsService } from '../../observability/metrics.service';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { NOTIFICATION_NEW_CHANNEL, type NotificationNewMessage } from './notifications.constants';
import { PushService } from './push.service';
import { Notification, NotificationDocument } from './schemas/notification.schema';

/** A page of notifications (newest first) plus an opaque cursor. */
export interface NotificationPage {
  items: NotificationContract[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Arguments to {@link NotificationsService.create}. */
export interface CreateNotificationInput {
  /** The account that should receive the notification. */
  recipientUserId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** The user who triggered it (optional). */
  actorId?: string;
  /** Optional in-app deep link. */
  link?: string;
}

/**
 * Owns the `notifications` collection and the in-app notifications center.
 *
 * {@link create} is the single entry point other modules call (friends, gifts,
 * matchmaking …): it PERSISTS the row, DELIVERS it in realtime via the
 * `notif:new` Redis channel (the matchmaking gateway, on whichever node holds
 * the recipient's socket, emits `notif:new` to their per-user room — mirroring
 * the `moderation:action` pattern so no module cycle is formed) and best-effort
 * FANS OUT a Web/Mobile push via {@link PushService}.
 *
 * Delivery side-effects are best-effort: a failure to publish or push never
 * fails the create (the row is the source of truth and `GET /notifications`
 * will still surface it).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly pushService: PushService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Create + deliver a notification. Persists the record, then (best-effort)
   * publishes `notif:new` for socket delivery and fans out a push. Returns the
   * stored record in the shared contract shape.
   *
   * A self-addressed notification (recipient === actor) is dropped — you never
   * notify someone about their own action.
   */
  async create(input: CreateNotificationInput): Promise<NotificationContract | null> {
    if (!Types.ObjectId.isValid(input.recipientUserId)) {
      this.logger.warn(`Skipping notification for invalid recipient: ${input.recipientUserId}`);
      return null;
    }
    if (input.actorId && input.actorId === input.recipientUserId) {
      return null;
    }

    const created = await this.notificationModel.create({
      recipientUserId: new Types.ObjectId(input.recipientUserId),
      kind: input.kind,
      title: input.title,
      body: input.body,
      read: false,
      actorId:
        input.actorId && Types.ObjectId.isValid(input.actorId)
          ? new Types.ObjectId(input.actorId)
          : null,
      link: input.link ?? null,
    });

    const contract = this.toContract(created);

    // Best-effort delivery — independent of each other and of the create.
    // `allSettled` so a rejecting publish/push NEVER escapes `create` (the row
    // is already persisted; delivery is fire-and-forget by contract).
    const realtime = this.toAppNotification(contract);
    await Promise.allSettled([
      this.publishNew(input.recipientUserId, realtime),
      this.pushService.fanOut(input.recipientUserId, realtime),
    ]);

    // Count the delivered notification (labelled by kind for per-type volume).
    this.metrics.notificationSent(contract.kind);

    return contract;
  }

  /**
   * A page of the caller's notifications, newest first. Cursor-paginated on the
   * monotonic `_id` (ObjectIds are time-ordered, so `_id DESC` == newest-first
   * and a single `_id < cursor` predicate is a stable keyset). `unreadOnly`
   * narrows to unseen items for the "unread" tab.
   */
  async list(userId: string, query: ListNotificationsQuery): Promise<NotificationPage> {
    if (!Types.ObjectId.isValid(userId)) {
      return { items: [], nextCursor: null, hasMore: false };
    }
    const filter: QueryFilter<NotificationDocument> = {
      recipientUserId: new Types.ObjectId(userId),
    };
    if (query.unreadOnly) {
      filter.read = false;
    }
    if (query.cursor) {
      if (!Types.ObjectId.isValid(query.cursor)) {
        // Unparseable cursor → terminal empty page rather than a 500.
        return { items: [], nextCursor: null, hasMore: false };
      }
      filter._id = { $lt: new Types.ObjectId(query.cursor) };
    }

    // Fetch one extra row to compute `hasMore` without a second query.
    const rows = await this.notificationModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(query.limit + 1)
      .exec();

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map((row) => this.toContract(row)),
      nextCursor: hasMore && last ? last._id.toString() : null,
      hasMore,
    };
  }

  /**
   * Mark a single notification read. Scoped to the owner so a user can't flip
   * someone else's notification. Idempotent (a no-match is a no-op).
   */
  async markRead(notificationId: string, userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(notificationId) || !Types.ObjectId.isValid(userId)) {
      return;
    }
    await this.notificationModel
      .updateOne(
        {
          _id: new Types.ObjectId(notificationId),
          recipientUserId: new Types.ObjectId(userId),
        },
        { $set: { read: true } },
      )
      .exec();
  }

  /** Mark ALL of the caller's unread notifications as read. */
  async markAllRead(userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      return;
    }
    await this.notificationModel
      .updateMany(
        { recipientUserId: new Types.ObjectId(userId), read: false },
        { $set: { read: true } },
      )
      .exec();
  }

  /** Count the caller's unread notifications (header badge). */
  async unreadCount(userId: string): Promise<number> {
    if (!Types.ObjectId.isValid(userId)) {
      return 0;
    }
    return this.notificationModel
      .countDocuments({ recipientUserId: new Types.ObjectId(userId), read: false })
      .exec();
  }

  // ── Realtime delivery ──────────────────────────────────────────────────────

  /**
   * Publish the `notif:new` payload on the cross-instance channel so the gateway
   * holding the recipient's socket emits it to their per-user room. Best-effort:
   * the persisted row is the source of truth.
   */
  private async publishNew(userId: string, notification: AppNotification): Promise<void> {
    const message: NotificationNewMessage = { userId, notification };
    try {
      await this.redis.publish(NOTIFICATION_NEW_CHANNEL, JSON.stringify(message));
    } catch (err) {
      this.logger.warn(`Failed to publish notif:new for ${userId}: ${asMessage(err)}`);
    }
  }

  // ── Mapping ────────────────────────────────────────────────────────────────

  /** Map a hydrated notification document to the shared `Notification` shape. */
  private toContract(doc: NotificationDocument): NotificationContract {
    return {
      id: doc._id.toString(),
      kind: doc.kind,
      title: doc.title,
      body: doc.body,
      read: doc.read,
      actorId: doc.actorId ? doc.actorId.toString() : null,
      link: doc.link ?? null,
      createdAt: (doc.get('createdAt') as Date).toISOString(),
    };
  }

  /**
   * Project a stored notification down to the lightweight realtime/push payload
   * (`AppNotification` = id/kind/title/body/createdAt) carried on `notif:new`.
   */
  private toAppNotification(contract: NotificationContract): AppNotification {
    return {
      id: contract.id,
      kind: contract.kind,
      title: contract.title,
      body: contract.body,
      createdAt: contract.createdAt,
    };
  }
}

/** Narrows an unknown thrown value to a printable message. */
function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
