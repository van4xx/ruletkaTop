import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter, Types } from 'mongoose';

import type { PaginationQuery, ReportStatus, ReviewItem } from '@ruletka/shared-types';

import { AdminService } from './admin.service';
import { ModerationEvent, ModerationEventDocument } from './schemas/moderation-event.schema';

/** A page of review items (newest-first) with an opaque cursor for the next page. */
export interface ReviewPage {
  items: ReviewItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** The review item + the resulting ban, returned by {@link ReviewService.resolveWithBan}. */
export interface ReviewResolvedWithBan {
  item: ReviewItem;
  ban: { userId: string; isBanned: boolean };
}

/** Terminal statuses a moderator may set when triaging a review item. */
const RESOLVABLE_STATUSES: readonly ReportStatus[] = ['resolved', 'dismissed'];

/**
 * Admin review queue over {@link ModerationEvent}s — the human-in-the-loop layer
 * on top of the automated escalation engine ({@link ModerationService}).
 *
 * Moderator surface (role-guarded in the controller): {@link listQueue}
 * (cursor-paginated, optional status filter; defaults to still-open items),
 * {@link resolve} (uphold ⇒ `resolved`, dismiss ⇒ `dismissed`) and
 * {@link resolveWithBan} (uphold AND ban the flagged user in one action). All
 * ride the `status + _id` index on the schema.
 */
@Injectable()
export class ReviewService {
  constructor(
    @InjectModel(ModerationEvent.name)
    private readonly eventModel: Model<ModerationEventDocument>,
    private readonly adminService: AdminService,
  ) {}

  /**
   * Cursor-paginated review queue, newest-first, optionally filtered by
   * `status`. `cursor` is the `_id` of the last item from the previous page
   * (older items have `_id < cursor`). Moderator-only (gated in the controller).
   */
  async listQueue(pagination: PaginationQuery, status?: ReportStatus): Promise<ReviewPage> {
    const filter: QueryFilter<ModerationEventDocument> = {};
    if (status) {
      filter.status = status;
    }
    if (pagination.cursor) {
      if (!Types.ObjectId.isValid(pagination.cursor)) {
        // An invalid cursor yields an empty (terminal) page rather than a 500.
        return { items: [], nextCursor: null, hasMore: false };
      }
      filter._id = { $lt: new Types.ObjectId(pagination.cursor) };
    }

    // Fetch one extra row to determine `hasMore` without a second query.
    const rows = await this.eventModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(pagination.limit + 1)
      .exec();

    const hasMore = rows.length > pagination.limit;
    const page = hasMore ? rows.slice(0, pagination.limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map((row) => this.toContract(row)),
      nextCursor: hasMore && last ? last._id.toString() : null,
      hasMore,
    };
  }

  /**
   * Resolve a review item: `resolved` (uphold) or `dismissed`.
   *
   * Upholding (`resolved`) leaves any auto-action in place. DISMISSING
   * (`dismissed`) declares the flag a false positive — so if the auto-escalation
   * had already SANCTIONED the user (`autoAction` of `ban` or `kick`; a `ban`
   * flips `isBanned`), dismissing it must REVERSE that sanction, otherwise a
   * cleared user stays banned. We therefore unban the flagged user on dismiss of
   * a ban/kick row, via the same idempotent {@link AdminService.unbanUser} the
   * manual `POST /admin/users/:id/unban` uses, so the reversal stays auditable.
   *
   * Moderator-only. Rejects any other target status and 404s an unknown id.
   */
  async resolve(eventId: string, status: ReportStatus): Promise<ReviewItem> {
    if (!RESOLVABLE_STATUSES.includes(status)) {
      throw new BadRequestException('status must be resolved or dismissed');
    }
    if (!Types.ObjectId.isValid(eventId)) {
      throw new NotFoundException('Review item not found');
    }
    // Read first so we know the auto-action a dismiss may need to reverse.
    const event = await this.eventModel.findById(new Types.ObjectId(eventId)).exec();
    if (!event) {
      throw new NotFoundException('Review item not found');
    }

    // Dismiss = false positive. Reverse a sanction the auto-policy already
    // applied (ban/kick), so a cleared user is actually un-banned. The unban
    // runs FIRST (idempotent) so a dismissed ban-row always implies a real unban.
    if (status === 'dismissed' && (event.autoAction === 'ban' || event.autoAction === 'kick')) {
      await this.adminService.unbanUser(event.userId.toString());
    }

    event.status = status;
    await event.save();
    return this.toContract(event);
  }

  /**
   * Uphold a flagged event AND ban the offending user in one action: apply a
   * real ban to the event's `userId` via {@link AdminService.banUser} (flips
   * `isBanned` + records a `banReason`, revokes sessions, force-disconnects
   * sockets), then close the event as `resolved`. Moderator-only. 404s an
   * unknown id.
   *
   * Like {@link ReportsService.resolveReportWithBan}, the ban runs FIRST so a
   * resolved item always implies a real sanction; the ban is idempotent, so a
   * retry after a transient failure is safe. Reversal stays explicit via
   * `POST /admin/users/:id/unban` so the two actions remain auditable.
   */
  async resolveWithBan(
    eventId: string,
    callerId?: string | null,
  ): Promise<ReviewResolvedWithBan> {
    if (!Types.ObjectId.isValid(eventId)) {
      throw new NotFoundException('Review item not found');
    }
    const event = await this.eventModel.findById(new Types.ObjectId(eventId)).exec();
    if (!event) {
      throw new NotFoundException('Review item not found');
    }

    // `callerId` is threaded through to {@link AdminService.banUser} so the audit
    // trail records the moderator who confirmed the AI flag.
    const ban = await this.adminService.banUser(
      event.userId.toString(),
      `Confirmed AI-flagged violation (${event.label}) #${event._id.toString()}`,
      callerId,
    );

    event.status = 'resolved';
    await event.save();

    return { item: this.toContract(event), ban };
  }

  /** Map a hydrated moderation-event document to the shared `ReviewItem` shape. */
  private toContract(doc: ModerationEventDocument): ReviewItem {
    return {
      id: doc._id.toString(),
      userId: doc.userId.toString(),
      matchId: doc.matchId ? doc.matchId.toString() : null,
      label: doc.label,
      score: doc.score,
      evidenceUrl: doc.evidenceUrl,
      autoAction: doc.autoAction,
      status: doc.status,
      createdAt: doc.get('createdAt').toISOString(),
    };
  }
}
