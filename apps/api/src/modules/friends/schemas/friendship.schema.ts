import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import type { FriendshipStatus } from '@ruletka/shared-types';

const FRIENDSHIP_STATUSES: readonly FriendshipStatus[] = ['pending', 'accepted', 'blocked'];

/**
 * A relationship between two accounts.
 *
 * `requesterId`/`recipientId` preserve DIRECTION (who initiated the request, so
 * only the recipient may accept), but a relationship is conceptually
 * UNORDERED — there must be at most one row per pair regardless of direction.
 * We enforce that with a derived {@link pairKey} (`"<minId>:<maxId>"`) carrying
 * a unique index, kept in sync by a pre-validate hook.
 */
@Schema({ collection: 'friendships', timestamps: { createdAt: true, updatedAt: false } })
export class Friendship {
  /** The account that sent the friend request. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  requesterId!: Types.ObjectId;

  /** The account that received the friend request. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  recipientId!: Types.ObjectId;

  @Prop({ required: true, enum: FRIENDSHIP_STATUSES, type: String, default: 'pending' })
  status!: FriendshipStatus;

  /**
   * Order-independent unique key for the pair, `"<minId>:<maxId>"` by hex
   * comparison. Maintained automatically (see the pre-validate hook) so callers
   * never set it directly.
   */
  @Prop({ required: true, type: String })
  pairKey!: string;

  // `createdAt` added by `timestamps`.
}

export type FriendshipDocument = HydratedDocument<Friendship>;

export const FriendshipSchema = SchemaFactory.createForClass(Friendship);

/** Build the canonical, order-independent pair key for two user ids. */
export function buildPairKey(a: Types.ObjectId | string, b: Types.ObjectId | string): string {
  const [first, second] = [a.toString(), b.toString()].sort();
  return `${first}:${second}`;
}

// Keep `pairKey` in sync with the participant ids before every validation pass.
// Async (Promise-returning) middleware form — no `next` callback needed.
FriendshipSchema.pre('validate', async function syncPairKey(this: FriendshipDocument) {
  if (this.requesterId && this.recipientId) {
    this.pairKey = buildPairKey(this.requesterId, this.recipientId);
  }
});

// ── Indexes (PROJECT_SPEC §6) ──────────────────────────────────────────────
// At most one friendship per unordered pair (regardless of who requested).
FriendshipSchema.index({ pairKey: 1 }, { unique: true });
// "My friends / my incoming-outgoing requests" lookups by participant + status.
FriendshipSchema.index({ requesterId: 1, status: 1 });
FriendshipSchema.index({ recipientId: 1, status: 1 });
