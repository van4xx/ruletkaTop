import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * An immutable audit-log entry: one record per privileged admin action.
 *
 * WAVE-1 provides the schema + {@link AuditService} so the contract and storage
 * exist now; the existing enforcement endpoints (ban/role) and every Wave-2
 * action endpoint should call `AuditService.log(...)` to append a row here. The
 * collection is append-only (no updates/deletes) — it is the tamper-evident
 * trail of who-did-what.
 *
 * `meta` carries action-specific context (e.g. `{ amount, reason }` for a
 * wallet adjustment) as free-form JSON. No secrets or card data are ever stored.
 */
@Schema({ collection: 'admin_audit_logs', timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog {
  /** The staff account that performed the action (null for system actions). */
  @Prop({ required: false, default: null, type: Types.ObjectId, ref: 'User' })
  actorId!: Types.ObjectId | null;

  /** Denormalised actor email for cheap rendering (the user row may change). */
  @Prop({ required: false, default: null, type: String })
  actorEmail!: string | null;

  /** Stable action verb, e.g. `user.ban`, `wallet.adjust`, `premium.grant`. */
  @Prop({ required: true, type: String })
  action!: string;

  /** What kind of entity the action targeted, e.g. `user`, `wallet`, `payment`. */
  @Prop({ required: false, default: null, type: String })
  targetType!: string | null;

  /** Id of the targeted entity (stringified — may be a Mongo id or external id). */
  @Prop({ required: false, default: null, type: String })
  targetId!: string | null;

  /** Action-specific context (no secrets). */
  @Prop({ required: false, default: null, type: Object })
  meta!: Record<string, unknown> | null;

  // `createdAt` is added by `timestamps`.
}

export type AuditLogDocument = HydratedDocument<AuditLog>;

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

// ── Indexes ────────────────────────────────────────────────────────────────
// The audit feed: newest first, paginated by _id.
AuditLogSchema.index({ _id: -1 });
// Filter by action (the queue's action facet), newest first.
AuditLogSchema.index({ action: 1, _id: -1 });
// All actions by one actor.
AuditLogSchema.index({ actorId: 1, _id: -1 });
