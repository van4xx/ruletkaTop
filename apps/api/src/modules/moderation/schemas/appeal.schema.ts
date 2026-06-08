import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import type { AppealStatus } from '@ruletka/shared-types';

/** Appeal lifecycle (mirrors `appealStatusSchema`). */
const APPEAL_STATUSES: readonly AppealStatus[] = ['pending', 'accepted', 'rejected'];

/**
 * A ban appeal filed by a banned account contesting its ban. Because a banned
 * user cannot authenticate (login is rejected), the appeal is created via a
 * CREDENTIAL-VERIFIED public endpoint (email + password re-prove identity) — the
 * resolved `userId` is recorded here.
 *
 * `email` / `nickname` / `banReason` are DENORMALISED at submit time so the
 * moderator queue reads without a per-row user/profile join, and so the appeal
 * still reads correctly even if the account is later deleted. A moderator
 * `accept`s (⇒ the user is unbanned) or `reject`s the appeal; the decision and
 * the deciding moderator are stamped on the row.
 */
@Schema({ collection: 'moderation_appeals', timestamps: { createdAt: true, updatedAt: true } })
export class Appeal {
  /** The banned account that filed the appeal. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId!: Types.ObjectId;

  /** Email captured at submit time (denormalised for the review queue). */
  @Prop({ required: true, type: String })
  email!: string;

  /** Display nickname captured at submit time (denormalised), or empty. */
  @Prop({ required: true, type: String, default: '' })
  nickname!: string;

  /** The ban reason at submit time, echoed for reviewer context, or `null`. */
  @Prop({ required: false, default: null, type: String })
  banReason!: string | null;

  /** The user's case for why the ban should be lifted (10–2000 chars). */
  @Prop({ required: true, type: String })
  message!: string;

  /** Lifecycle: `pending` until a moderator accepts/rejects it. */
  @Prop({ required: true, enum: APPEAL_STATUSES, type: String, default: 'pending' })
  status!: AppealStatus;

  /** When a moderator decided the appeal, or `null` while pending. */
  @Prop({ required: false, default: null, type: Date })
  resolvedAt!: Date | null;

  /** Moderator/admin who decided the appeal, or `null` while pending. */
  @Prop({ required: false, default: null, type: Types.ObjectId, ref: 'User' })
  decidedBy!: Types.ObjectId | null;

  // `createdAt` / `updatedAt` added by `timestamps`.
}

export type AppealDocument = HydratedDocument<Appeal>;

export const AppealSchema = SchemaFactory.createForClass(Appeal);

// ── Indexes ────────────────────────────────────────────────────────────────
// Admin review queue: pending/decided appeals, newest first (status + _id paginates).
AppealSchema.index({ status: 1, _id: -1 });
// ONE-PENDING-PER-USER, DB-enforced: a PARTIAL unique index over `{ userId }`
// restricted to `status: 'pending'`. Because the filter only covers pending
// rows, a user may still have many *decided* (accepted/rejected) appeals in
// history, but at most one open one — closing the check-then-create race in
// `AppealsService.submitAppeal` (a concurrent second submit now hits E11000,
// which the service maps to the same 409 as the explicit pre-check).
AppealSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);
// Per-user history (all statuses), newest first.
AppealSchema.index({ userId: 1, _id: -1 });
