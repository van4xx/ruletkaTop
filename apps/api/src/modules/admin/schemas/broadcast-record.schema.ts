import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import type { AdminBroadcastSegment } from '@ruletka/shared-types';

/** Audience segments a broadcast can target (mirrors the shared contract). */
const BROADCAST_SEGMENTS: readonly AdminBroadcastSegment[] = ['all', 'premium', 'active', 'banned'];

/**
 * A persisted record of one sent BROADCAST.
 *
 * WAVE-2 turns the Wave-1 stub into real history: every successful fan-out (the
 * existing real `POST /admin/broadcast`) inserts a row here (collection
 * `broadcasts`), and `GET /admin/broadcast` reads them back newest-first.
 *
 * `recipientCount` is the number of recipients actually delivered to (best-
 * effort delivery — a single failure never aborts the run, so this is the
 * delivered count, not merely the targeted count). `sentBy` links the staff
 * account for the audit trail.
 */
@Schema({ collection: 'broadcasts', timestamps: { createdAt: true, updatedAt: false } })
export class BroadcastRecord {
  /** Notification title that was sent. */
  @Prop({ required: true, type: String })
  title!: string;

  /** Notification body that was sent. */
  @Prop({ required: true, type: String })
  body!: string;

  /** The audience segment the fan-out targeted. */
  @Prop({ required: true, enum: BROADCAST_SEGMENTS, type: String })
  segment!: AdminBroadcastSegment;

  /** How many recipients were actually delivered to. */
  @Prop({ required: true, default: 0, min: 0, type: Number })
  recipientCount!: number;

  /** The staff account that sent it (audit link; null for system sends). */
  @Prop({ required: false, default: null, type: Types.ObjectId, ref: 'User' })
  sentBy!: Types.ObjectId | null;

  // `createdAt` is added by `timestamps`.
}

export type BroadcastRecordDocument = HydratedDocument<BroadcastRecord>;

export const BroadcastRecordSchema = SchemaFactory.createForClass(BroadcastRecord);

// ── Indexes ──────────────────────────────────────────────────────────────────
// Broadcast history: newest first.
BroadcastRecordSchema.index({ _id: -1 });
