import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import type { MessageType } from '@ruletka/shared-types';

const MESSAGE_TYPES: readonly MessageType[] = ['text', 'image', 'gift'];

/**
 * A single direct message inside a {@link Conversation}.
 *
 * `readAt` is the recipient's read receipt (`null` until read). Messages are
 * immutable once created; edits/deletes are out of scope. Cursor pagination
 * uses `_id` (monotonic with creation order) so no extra cursor field is needed.
 */
@Schema({ collection: 'messages', timestamps: { createdAt: true, updatedAt: false } })
export class Message {
  /** Owning conversation. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'Conversation' })
  conversationId!: Types.ObjectId;

  /** Author of the message. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  senderId!: Types.ObjectId;

  @Prop({ required: true, enum: MESSAGE_TYPES, type: String, default: 'text' })
  type!: MessageType;

  /** Message body (text, image URL, or gift reference depending on `type`). */
  @Prop({ required: true, type: String })
  content!: string;

  /** When the recipient read this message, or `null` if unread. */
  @Prop({ required: false, default: null, type: Date })
  readAt!: Date | null;

  // `createdAt` added by `timestamps`.
}

export type MessageDocument = HydratedDocument<Message>;

export const MessageSchema = SchemaFactory.createForClass(Message);

// ── Indexes (PROJECT_SPEC §6) ──────────────────────────────────────────────
// Thread reads: messages of a conversation, newest-first cursor pagination.
MessageSchema.index({ conversationId: 1, _id: -1 });
// Unread counting: unread messages in a conversation NOT authored by the viewer.
MessageSchema.index({ conversationId: 1, senderId: 1, readAt: 1 });
