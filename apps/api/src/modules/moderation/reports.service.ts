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
import {
  EVIDENCE_RETENTION_CEILING_MS,
  EVIDENCE_RETENTION_FLOOR_MS,
  EVIDENCE_TERMINAL_STATUSES,
} from './moderation.constants';
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
 * Child-safety / violence reasons are HIGH-SEVERITY: a report carrying one of
 * these is created already in `reviewing` (not `open`) so it jumps the triage
 * queue ahead of routine `open` reports — a `minor` (CSAM-risk) complaint must
 * never sit behind spam. {@link ReportsService.createReport} uses this set.
 */
const HIGH_SEVERITY_REASONS: ReadonlySet<CreateReportDto['reason']> = new Set([
  'minor',
  'violence',
]);

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
      // High-severity (child-safety / violence) reports skip the `open` lane and
      // are filed `reviewing` so the moderator fast-lane surfaces them first.
      status: HIGH_SEVERITY_REASONS.has(dto.reason) ? 'reviewing' : 'open',
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
   *
   * TERMINAL-STATE GUARD: the decision is an ATOMIC `findOneAndUpdate` scoped to
   * a still-undecided report (`status ∈ {open, reviewing}`). A `resolved` /
   * `dismissed` report is terminal and CANNOT be re-decided here — reversing a
   * deliberate decision must go through the explicit, audited unban path, never
   * by silently flipping a closed report's status. The atomicity also stops two
   * concurrent moderators from both "winning": the loser's update matches no
   * still-open row. A null result is then disambiguated by a second read —
   * truly-missing ⇒ `404`, already-decided ⇒ `409 Conflict`.
   */
  async resolveReport(reportId: string, status: ReportStatus): Promise<ReportContract> {
    if (!RESOLVABLE_STATUSES.includes(status)) {
      throw new BadRequestException('status must be resolved or dismissed');
    }
    if (!Types.ObjectId.isValid(reportId)) {
      throw new NotFoundException('Report not found');
    }
    const updated = await this.reportModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(reportId), status: { $in: OPEN_REPORT_STATUSES } },
        { $set: { status } },
        { new: true },
      )
      .exec();
    if (!updated) {
      // No still-open row matched: either the id is unknown (404) or the report
      // was already decided (409) — distinguish with a plain existence check so
      // a deliberate decision is never silently re-applied.
      const exists = await this.reportModel
        .exists({ _id: new Types.ObjectId(reportId) })
        .exec();
      if (!exists) {
        throw new NotFoundException('Report not found');
      }
      throw new ConflictException('Report already decided');
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
   * TERMINAL-STATE GUARD: we ATOMICALLY claim the report (`findOneAndUpdate`
   * `status ∈ {open, reviewing}` → `resolved`) BEFORE banning, so an
   * already-decided report can never resurrect a ban and two concurrent
   * upholders can't double-ban (only one claim matches the still-open row). A
   * null claim is disambiguated: missing ⇒ `404`, already-decided ⇒ `409`.
   *
   * Ordering: the status flip therefore lands FIRST and the ban second. The ban
   * is idempotent, so if its write fails the moderator retries the SAME id — the
   * report is already `resolved`, the retry re-claims nothing, but the read
   * below re-applies the (idempotent) ban so a resolved report always ends up
   * implying a real ban. Reversal stays explicit + audited via
   * `POST /admin/users/:id/unban`. The ban reason embeds the report id.
   */
  async resolveReportWithBan(
    reportId: string,
    callerId?: string | null,
  ): Promise<ResolvedWithBan> {
    if (!Types.ObjectId.isValid(reportId)) {
      throw new NotFoundException('Report not found');
    }
    // Atomically claim the still-open report by flipping it to `resolved`. This
    // is the locking step: only ONE concurrent caller can win it, and an
    // already-decided report matches nothing (so a closed report can't be
    // re-upheld into a fresh ban).
    const report = await this.reportModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(reportId), status: { $in: OPEN_REPORT_STATUSES } },
        { $set: { status: 'resolved' } },
        { new: true },
      )
      .exec();
    if (!report) {
      const exists = await this.reportModel
        .exists({ _id: new Types.ObjectId(reportId) })
        .exec();
      if (!exists) {
        throw new NotFoundException('Report not found');
      }
      throw new ConflictException('Report already decided');
    }

    const targetUserId = report.againstUserId.toString();
    // Apply the sanction. `callerId` is threaded through to
    // {@link AdminService.banUser} so the audit trail records the moderator who
    // upheld the report. The ban is idempotent (safe to retry).
    const ban = await this.adminService.banUser(
      targetUserId,
      `Upheld abuse report (${report.reason}) #${report._id.toString()}`,
      callerId,
    );

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

  /**
   * Retention sweep for captured abuse-report EVIDENCE (152-ФЗ / GDPR
   * data-minimisation): null the `evidenceUrl` blob on `reports` whose evidence
   * has aged past the retention bound, RETAINING the row (reason/status/target)
   * so the moderation record survives.
   *
   * A report's frame is purged when EITHER the case is TERMINAL
   * (`resolved`/`dismissed`) and at least {@link EVIDENCE_RETENTION_FLOOR_MS}
   * has elapsed since the decision (`updatedAt`), OR
   * {@link EVIDENCE_RETENTION_CEILING_MS} has elapsed since filing (`createdAt`)
   * regardless of status. Mirrors {@link ReviewService.sweepExpiredEvidence}.
   *
   * Idempotent (only matches rows that still HAVE an `evidenceUrl`). Returns the
   * number of frames purged.
   */
  async sweepExpiredEvidence(now: Date = new Date()): Promise<number> {
    const floorCutoff = new Date(now.getTime() - EVIDENCE_RETENTION_FLOOR_MS);
    const ceilingCutoff = new Date(now.getTime() - EVIDENCE_RETENTION_CEILING_MS);
    const res = await this.reportModel
      .updateMany(
        {
          evidenceUrl: { $ne: null },
          $or: [
            { status: { $in: EVIDENCE_TERMINAL_STATUSES }, updatedAt: { $lte: floorCutoff } },
            { createdAt: { $lte: ceilingCutoff } },
          ],
        },
        { $set: { evidenceUrl: null } },
      )
      .exec();
    return res.modifiedCount ?? 0;
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
