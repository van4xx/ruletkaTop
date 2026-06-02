import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type { Block as BlockContract, CreateBlockDto } from '@ruletka/shared-types';

import { UsersService } from '../users/users.service';
import { Block, BlockDocument } from './schemas/block.schema';

/** MongoDB duplicate-key error code. */
const DUPLICATE_KEY_CODE = 11000;

/** Type guard for a MongoDB duplicate-key write error. */
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: number }).code === DUPLICATE_KEY_CODE
  );
}

/**
 * Owns the `blocks` collection.
 *
 * A row is DIRECTIONAL (`userId` blocked `blockedUserId`) so each user manages
 * only their own blocks, but interaction gating treats a block as
 * BIDIRECTIONAL: if either side blocked the other, they cannot interact.
 *
 * Exported cross-module (consumed by chat / matchmaking / calls):
 * {@link isBlocked} and {@link listBlockedIds}.
 */
@Injectable()
export class BlocksService {
  constructor(
    @InjectModel(Block.name) private readonly blockModel: Model<BlockDocument>,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Create a block from `userId` against `blockedUserId`. Self-blocks are
   * rejected; the target must exist; a duplicate block is surfaced as a `409`
   * conflict via the unique index. Returns the created block.
   */
  async createBlock(userId: string, dto: CreateBlockDto): Promise<BlockContract> {
    if (userId === dto.blockedUserId) {
      throw new ConflictException('Cannot block yourself');
    }
    // The blocked account must exist (id already validated as an ObjectId).
    const target = await this.usersService.findById(dto.blockedUserId);
    if (!target) {
      throw new NotFoundException('User not found');
    }
    try {
      const created = await this.blockModel.create({
        userId: new Types.ObjectId(userId),
        blockedUserId: new Types.ObjectId(dto.blockedUserId),
      });
      return this.toContract(created);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictException('User already blocked');
      }
      throw err;
    }
  }

  /** Remove a block (idempotent — removing a non-existent block is a no-op). */
  async removeBlock(userId: string, blockedUserId: string): Promise<void> {
    if (!Types.ObjectId.isValid(blockedUserId)) {
      return;
    }
    await this.blockModel
      .deleteOne({
        userId: new Types.ObjectId(userId),
        blockedUserId: new Types.ObjectId(blockedUserId),
      })
      .exec();
  }

  /** List blocks created BY `userId` (the rows this user owns), newest first. */
  async listOwnBlocks(userId: string): Promise<BlockContract[]> {
    const rows = await this.blockModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .exec();
    return rows.map((row) => this.toContract(row));
  }

  /**
   * Whether `viewer` and `target` are blocked from interacting in EITHER
   * direction. Returns `false` for invalid ids rather than throwing so callers
   * can use it as a cheap gate.
   */
  async isBlocked(viewer: string, target: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(viewer) || !Types.ObjectId.isValid(target)) {
      return false;
    }
    const viewerId = new Types.ObjectId(viewer);
    const targetId = new Types.ObjectId(target);
    const existing = await this.blockModel
      .exists({
        $or: [
          { userId: viewerId, blockedUserId: targetId },
          { userId: targetId, blockedUserId: viewerId },
        ],
      })
      .exec();
    return existing !== null;
  }

  /**
   * All user ids that `userId` should not see / be matched with: everyone they
   * blocked PLUS everyone who blocked them (bidirectional gating). Returned as
   * a de-duplicated array of hex-string ids.
   */
  async listBlockedIds(userId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(userId)) {
      return [];
    }
    const id = new Types.ObjectId(userId);
    const rows = await this.blockModel
      .find({ $or: [{ userId: id }, { blockedUserId: id }] })
      .select({ userId: 1, blockedUserId: 1 })
      .lean()
      .exec();

    const ids = new Set<string>();
    for (const row of rows) {
      const owner = row.userId.toString();
      const blocked = row.blockedUserId.toString();
      // Add whichever side is NOT the querying user.
      ids.add(owner === userId ? blocked : owner);
    }
    return [...ids];
  }

  /** Map a hydrated block document to the shared `Block` contract shape. */
  private toContract(doc: BlockDocument): BlockContract {
    return {
      id: doc._id.toString(),
      userId: doc.userId.toString(),
      blockedUserId: doc.blockedUserId.toString(),
      createdAt: doc.get('createdAt').toISOString(),
    };
  }
}
