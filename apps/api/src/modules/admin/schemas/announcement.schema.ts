import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * A platform ANNOUNCEMENT (system banner / changelog entry) authored from the
 * admin panel.
 *
 * WAVE-2 turns the Wave-1 stub into real persistence: announcements are stored
 * here (collection `announcements`), listed newest-first on the Content page,
 * and toggled active/edited/deleted by admins. `active` gates whether the entry
 * is "live" (a future client surface can render active announcements as a
 * banner). Optional `startsAt`/`endsAt` bound a scheduled window; both `null`
 * means "show whenever active".
 *
 * `createdBy` links the authoring staff account for the audit trail (the
 * privileged create/patch/delete are also recorded via {@link AuditService}).
 */
@Schema({ collection: 'announcements', timestamps: true })
export class Announcement {
  /** Short headline shown in the banner / list. */
  @Prop({ required: true, trim: true, type: String })
  title!: string;

  /** Body copy. */
  @Prop({ required: true, trim: true, type: String })
  body!: string;

  /** Whether the announcement is live. Toggled from the admin panel. */
  @Prop({ required: true, default: true, type: Boolean })
  active!: boolean;

  /** The staff account that authored it (audit link; null for legacy rows). */
  @Prop({ required: false, default: null, type: Types.ObjectId, ref: 'User' })
  createdBy!: Types.ObjectId | null;

  /** Optional scheduled start; `null` = no lower bound. */
  @Prop({ required: false, default: null, type: Date })
  startsAt!: Date | null;

  /** Optional scheduled end; `null` = no upper bound. */
  @Prop({ required: false, default: null, type: Date })
  endsAt!: Date | null;

  // `createdAt` / `updatedAt` are added by `timestamps: true`.
}

export type AnnouncementDocument = HydratedDocument<Announcement>;

export const AnnouncementSchema = SchemaFactory.createForClass(Announcement);

// ── Indexes ──────────────────────────────────────────────────────────────────
// NOTE: the admin list paginates newest-first by `_id`, served from Mongo's
// default `{ _id: 1 }` index via a reverse scan — a lone `{ _id: -1 }` index is
// rejected/redundant, so it is intentionally NOT declared here.
// Fast "active announcements" lookup for a future client banner surface.
AnnouncementSchema.index({ active: 1, _id: -1 });
