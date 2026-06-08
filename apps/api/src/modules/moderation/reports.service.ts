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
  OpenReportCount,
  PaginationQuery,
  Report as ReportContract,
  ReportStatus,
} from '@ruletka/shared-types';

import { UsersService } from '../users/users.service';
import { AdminService } from './admin.service';
import { Report, ReportDocument } from './schemas/report.schema';

/** A page of reports (newest-first) with an opaque cursor for the next page. */
export interface ReportPage {
  items: ReportContract[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** The report + the resulting ban, returned by {@link ReportsService.resolveReportWithBan}. */
export interface ResolvedWithBan {
  report: ReportContract;
  ban: { userId: string; isBanned: boolean };
}

/**
 * Statuses that count as an OPEN report for the per-target aggregate: a report
 * still awaiting (`open`) or under (`reviewing`) moderator action. `resolved` /
 * `dismissed` are terminal and excluded.
 */
const OPEN_REPORT_STATUSES: readonly ReportStatus[] = ['open', 'reviewing'];

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
 * (cursor-paginated triage queue, optional status filter), {@link resolveReport}
 * (close as resolved/dismissed), {@link resolveReportWithBan} (uphold AND apply
 * a real ban to the reported user) and {@link countOpenReportsByTarget}
 * (most-reported-users aggregate). These read/write behind the
 * `againstUserId + status` and `createdAt` indexes on the schema.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name) private readonly reportModel: Model<ReportDocument>,
    private readonly usersService: UsersService,
    private readonly adminService: AdminService,
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
      // Retain the optional in-call evidence frame for moderator review.
      evidenceUrl: dto.evidence ?? null,
      status: 'open',
    });
    return this.toContract(created);
  }

  /**
   * Cursor-paginated triage queue, newest-first, optionally filtered by
   * `status` and/or `againstUserId` (every report filed AGAINST a given user —
   * the per-target dossier view investigators use). The `cursor` is the `_id` of
   * the last item from the previous page (fetch older reports with
   * `_id < cursor`). Moderator-only (gated in the controller). The
   * `againstUserId + status` index backs the combined filter.
   *
   * `againstUserId` is already validated as a 24-char-hex ObjectId by the query
   * pipe, so it is safe to cast here.
   */
  async listReports(
    pagination: PaginationQuery,
    status?: ReportStatus,
    againstUserId?: string,
  ): Promise<ReportPage> {
    const filter: QueryFilter<ReportDocument> = {};
    if (status) {
      filter.status = status;
    }
    if (againstUserId) {
      filter.againstUserId = new Types.ObjectId(againstUserId);
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

  /**
   * Uphold a report AND sanction the reported user: close the report as
   * `resolved` and apply a real ban to `againstUserId` via
   * {@link AdminService.banUser} (flips `isBanned` + records a `banReason`,
   * revokes sessions, force-disconnects sockets). Moderator-only (gated in the
   * controller). 404s an unknown report id.
   *
   * Ordering: ban FIRST, then mark the report resolved — so if the ban write
   * fails we don't leave a report marked resolved against an un-sanctioned user
   * (the moderator sees the error and can retry). The ban is idempotent, so a
   * retry after a transient failure is safe.
   *
   * The whole sanction is also recorded as a fresh moderation outcome (the ban
   * reason embeds the report id) so the action stays auditable and is reversible
   * via the existing explicit `POST /admin/users/:id/unban`.
   */
  async resolveReportWithBan(reportId: string): Promise<ResolvedWithBan> {
    if (!Types.ObjectId.isValid(reportId)) {
      throw new NotFoundException('Report not found');
    }
    const report = await this.reportModel.findById(new Types.ObjectId(reportId)).exec();
    if (!report) {
      throw new NotFoundException('Report not found');
    }

    const targetUserId = report.againstUserId.toString();
    // Apply the sanction first so a resolved report always implies a real ban.
    const ban = await this.adminService.banUser(
      targetUserId,
      `Upheld abuse report (${report.reason}) #${report._id.toString()}`,
    );

    report.status = 'resolved';
    await report.save();

    return { report: this.toContract(report), ban };
  }

  /**
   * Aggregate the number of still-OPEN reports ({@link OPEN_REPORT_STATUSES})
   * per reported user, most-reported first. Powers a "users with the most open
   * complaints" moderation view. Moderator-only (gated in the controller).
   *
   * Rides the `againstUserId + status` index. Bounded by `limit` (the caller
   * passes a sane cap) so the result set never grows unbounded.
   */
  async countOpenReportsByTarget(limit: number): Promise<OpenReportCount[]> {
    const rows = await this.reportModel
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { status: { $in: OPEN_REPORT_STATUSES } } },
        { $group: { _id: '$againstUserId', count: { $sum: 1 } } },
        // Tie-break on the user id so equal counts paginate deterministically.
        { $sort: { count: -1, _id: 1 } },
        { $limit: limit },
      ])
      .exec();

    return rows.map((row) => ({
      againstUserId: row._id.toString(),
      openReports: row.count,
    }));
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
      evidenceUrl: doc.evidenceUrl ?? null,
      status: doc.status,
      createdAt: doc.get('createdAt').toISOString(),
    };
  }
}
