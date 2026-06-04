import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter, Types } from 'mongoose';

import type { AdminAuditEntry, AdminAuditList, AdminAuditQuery } from '@ruletka/shared-types';

import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';

/** Arguments to {@link AuditService.log}. */
export interface AuditLogInput {
  /** The staff account performing the action (id + email for the trail). */
  actorId?: string | null;
  actorEmail?: string | null;
  /** Stable action verb, e.g. `user.ban`, `wallet.adjust`. */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  meta?: Record<string, unknown> | null;
}

/**
 * Append-only audit trail for privileged admin actions.
 *
 * EXPORTED from {@link AdminModule} so the existing enforcement controllers and
 * every Wave-2 action endpoint can record who-did-what by calling {@link log}.
 * Writes are best-effort: a logging failure NEVER fails the action it records
 * (the action is authoritative; the log is a side-effect), so callers `await`
 * it without a try/catch.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLogDocument>,
  ) {}

  /**
   * Append an audit record. Best-effort — swallows storage errors (logged) so a
   * failed write can't break the privileged action that triggered it.
   */
  async log(input: AuditLogInput): Promise<void> {
    try {
      await this.auditModel.create({
        actorId:
          input.actorId && Types.ObjectId.isValid(input.actorId)
            ? new Types.ObjectId(input.actorId)
            : null,
        actorEmail: input.actorEmail ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        meta: input.meta ?? null,
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log for action "${input.action}": ${(err as Error).message}`,
      );
    }
  }

  /**
   * A cursor-paginated page of the audit feed (newest first), optionally
   * filtered by `action`. Keyset-paginated on `_id` (time-ordered), matching the
   * other admin list surfaces.
   */
  async list(query: AdminAuditQuery): Promise<AdminAuditList> {
    const filter: QueryFilter<AuditLogDocument> = {};
    if (query.action) {
      filter.action = query.action;
    }
    if (query.cursor && Types.ObjectId.isValid(query.cursor)) {
      filter._id = { $lt: new Types.ObjectId(query.cursor) };
    }

    const rows = await this.auditModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(query.limit + 1)
      .lean()
      .exec();

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map((row) => this.toEntry(row)),
      nextCursor: hasMore && last ? last._id.toString() : null,
      hasMore,
    };
  }

  /** Map a lean audit document to the shared contract shape. */
  private toEntry(row: {
    _id: Types.ObjectId;
    actorId?: Types.ObjectId | null;
    actorEmail?: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    meta?: Record<string, unknown> | null;
    createdAt?: Date;
  }): AdminAuditEntry {
    return {
      id: row._id.toString(),
      actorId: row.actorId ? row.actorId.toString() : null,
      actorEmail: row.actorEmail ?? null,
      action: row.action,
      targetType: row.targetType ?? null,
      targetId: row.targetId ?? null,
      meta: row.meta ?? null,
      createdAt: (row.createdAt ?? new Date()).toISOString(),
    };
  }
}
