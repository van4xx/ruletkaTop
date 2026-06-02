import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter, Types } from 'mongoose';

import type {
  CreateReportDto,
  PaginationQuery,
  Report as ReportContract,
  ReportStatus,
} from '@ruletka/shared-types';

import { UsersService } from '../users/users.service';
import { Report, ReportDocument } from './schemas/report.schema';

/** A page of reports (newest-first) with an opaque cursor for the next page. */
export interface ReportPage {
  items: ReportContract[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Window (ms) within which a repeat report by the same reporter against the
 * same user is treated as a duplicate and rejected (spam / accidental
 * double-submit guard). Defaults to 24h.
 */
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Terminal statuses a moderator may set when triaging a report. */
const RESOLVABLE_STATUSES: readonly ReportStatus[] = ['resolved', 'dismissed'];

/**
 * Owns the `reports` collection — user-submitted abuse reports against other
 * users, optionally tied to the match where the incident occurred.
 *
 * User surface: {@link createReport} (write). Reports are validated (target must
 * exist) and de-duplicated per (reporter, target) within {@link DEDUPE_WINDOW_MS}.
 *
 * Moderator surface (role-guarded in the controller): {@link listReports}
 * (cursor-paginated triage queue, optional status filter) and
 * {@link resolveReport} (close as resolved/dismissed). These read/write behind
 * the `againstUserId + status` and `createdAt` indexes on the schema.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name) private readonly reportModel: Model<ReportDocument>,
    private readonly usersService: UsersService,
  ) {}

  /**
   * File a report from `fromUserId`. Self-reports are rejected, the target must
   * exist, and a repeat report against the same user within
   * {@link DEDUPE_WINDOW_MS} is rejected as a duplicate. The report is created in
   * the `open` state for moderator triage.
   */
  async createReport(fromUserId: string, dto: CreateReportDto): Promise<ReportContract> {
    if (fromUserId === dto.againstUserId) {
      throw new BadRequestException('Cannot report yourself');
    }

    // The reported account must exist (ids are already validated as ObjectIds
    // by the zod pipe, so a miss here means "no such user", not "malformed").
    const target = await this.usersService.findById(dto.againstUserId);
    if (!target) {
      throw new NotFoundException('Reported user not found');
    }

    const fromId = new Types.ObjectId(fromUserId);
    const againstId = new Types.ObjectId(dto.againstUserId);

    // Dedupe: same reporter → same target within the window is a duplicate.
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const recent = await this.reportModel
      .exists({
        fromUserId: fromId,
        againstUserId: againstId,
        createdAt: { $gte: since },
      })
      .exec();
    if (recent) {
      throw new ConflictException('You have already reported this user recently');
    }

    const created = await this.reportModel.create({
      fromUserId: fromId,
      againstUserId: againstId,
      matchId: dto.matchId ? new Types.ObjectId(dto.matchId) : null,
      reason: dto.reason,
      details: dto.details ?? null,
      status: 'open',
    });
    return this.toContract(created);
  }

  /**
   * Cursor-paginated triage queue, newest-first, optionally filtered by
   * `status`. The `cursor` is the `_id` of the last item from the previous page
   * (fetch older reports with `_id < cursor`). Moderator-only (gated in the
   * controller).
   */
  async listReports(pagination: PaginationQuery, status?: ReportStatus): Promise<ReportPage> {
    const filter: QueryFilter<ReportDocument> = {};
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
    const rows = await this.reportModel
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
   * Close a report as `resolved` or `dismissed`. Moderator-only (gated in the
   * controller). Rejects any other target status and 404s an unknown id.
   */
  async resolveReport(reportId: string, status: ReportStatus): Promise<ReportContract> {
    if (!RESOLVABLE_STATUSES.includes(status)) {
      throw new BadRequestException('status must be resolved or dismissed');
    }
    if (!Types.ObjectId.isValid(reportId)) {
      throw new NotFoundException('Report not found');
    }
    const updated = await this.reportModel
      .findByIdAndUpdate(new Types.ObjectId(reportId), { $set: { status } }, { new: true })
      .exec();
    if (!updated) {
      throw new NotFoundException('Report not found');
    }
    return this.toContract(updated);
  }

  /** Map a hydrated report document to the shared `Report` contract shape. */
  private toContract(doc: ReportDocument): ReportContract {
    return {
      id: doc._id.toString(),
      fromUserId: doc.fromUserId.toString(),
      againstUserId: doc.againstUserId.toString(),
      matchId: doc.matchId ? doc.matchId.toString() : null,
      reason: doc.reason,
      details: doc.details,
      status: doc.status,
      createdAt: doc.get('createdAt').toISOString(),
    };
  }
}
