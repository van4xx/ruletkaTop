import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * A directional block: `userId` no longer wishes to interact with
 * `blockedUserId`. Interaction gating treats a block as bidirectionally
 * effective (see {@link BlocksService.isBlocked}), but each row records who
 * initiated it so a user can manage (and undo) only their own blocks.
 */
@Schema({ collection: 'blocks', timestamps: { createdAt: true, updatedAt: false } })
export class Block {
  /** The user who created the block (owner of this row). */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId!: Types.ObjectId;

  /** The user being blocked. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  blockedUserId!: Types.ObjectId;

  // `createdAt` added by `timestamps`.
}

export type BlockDocument = HydratedDocument<Block>;

export const BlockSchema = SchemaFactory.createForClass(Block);

// ── Indexes (PROJECT_SPEC §6) ──────────────────────────────────────────────
// A user can block another at most once (directional uniqueness).
BlockSchema.index({ userId: 1, blockedUserId: 1 }, { unique: true });
// Reverse lookup: "who has blocked me?" — powers bidirectional gating cheaply.
BlockSchema.index({ blockedUserId: 1 });
