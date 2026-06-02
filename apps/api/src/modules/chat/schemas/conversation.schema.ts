import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * A 1:1 direct-message thread between exactly two participants.
 *
 * Conversations are UNORDERED: there is at most one thread per pair regardless
 * of who started it, enforced by a derived {@link pairKey} (`"<minId>:<maxId>"`)
 * with a unique index. `lastMessageAt` / `lastMessagePreview` are denormalised
 * for cheap inbox rendering (sort + preview without touching `messages`).
 * `unreadCount` is per-viewer and therefore computed at read time, never stored.
 */
@Schema({ collection: 'conversations', timestamps: true })
export class Conversation {
  /** The two participant account ids (exactly two). */
  @Prop({ required: true, type: [Types.ObjectId], ref: 'User' })
  participants!: Types.ObjectId[];

  /**
   * Order-independent unique key for the pair, `"<minId>:<maxId>"` by hex
   * comparison. Maintained by the service on creation.
   */
  @Prop({ required: true, type: String })
  pairKey!: string;

  /** Timestamp of the most recent message, or `null` for an empty thread. */
  @Prop({ required: false, default: null, type: Date })
  lastMessageAt!: Date | null;

  /** Short preview of the most recent message, or `null`. */
  @Prop({ required: false, default: null, type: String })
  lastMessagePreview!: string | null;

  // `createdAt` / `updatedAt` added by `timestamps: true`.
}

export type ConversationDocument = HydratedDocument<Conversation>;

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

/** Build the canonical, order-independent pair key for two participant ids. */
export function buildConversationPairKey(
  a: Types.ObjectId | string,
  b: Types.ObjectId | string,
): string {
  const [first, second] = [a.toString(), b.toString()].sort();
  return `${first}:${second}`;
}

// ── Indexes (PROJECT_SPEC §6) ──────────────────────────────────────────────
// At most one conversation per unordered participant pair.
ConversationSchema.index({ pairKey: 1 }, { unique: true });
// Inbox: "my conversations, most-recently-active first".
ConversationSchema.index({ participants: 1, lastMessageAt: -1 });
