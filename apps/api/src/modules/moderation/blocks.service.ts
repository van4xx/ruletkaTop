import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Redis } from 'ioredis';
import { Connection, Model, Types } from 'mongoose';

import type {
  Block as BlockContract,
  BlockedUser as BlockedUserContract,
  CreateBlockDto,
} from '@ruletka/shared-types';

import { REDIS_CLIENT } from '../../redis/redis.constants';
import { UsersService } from '../users/users.service';
import { BLOCK_ENFORCE_CHANNEL, type BlockEnforceMessage } from './moderation.constants';
import { Block, BlockDocument } from './schemas/block.schema';

/** Minimal public identity batch-joined onto a blocklist row. */
interface ProfileIdentity {
  nickname: string;
  avatarUrl: string | null;
}

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
 *
 * On block creation it also PUBLISHES to {@link BLOCK_ENFORCE_CHANNEL} so the
 * realtime gateway force-ends any call currently in progress between the two
 * users (a block must cut a live call, not merely block future matches).
 */
@Injectable()
export class BlocksService {
  private readonly logger = new Logger(BlocksService.name);

  constructor(
    @InjectModel(Block.name) private readonly blockModel: Model<BlockDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly usersService: UsersService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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
      // Best-effort: force-end any call currently in progress between the two.
      // A failure here must never fail the block (the row is already written and
      // the bidirectional gate prevents re-matching), so we don't await/throw.
      void this.publishBlockEnforce(userId, dto.blockedUserId);
      return this.toContract(created);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictException('User already blocked');
      }
      throw err;
    }
  }

  /**
   * Publish the new block on {@link BLOCK_ENFORCE_CHANNEL} so the realtime
   * gateway tears down any active call between the two users. Best-effort: a
   * coordination failure is logged, never thrown (the block itself is already
   * effective).
   */
  private async publishBlockEnforce(userId: string, blockedUserId: string): Promise<void> {
    const message: BlockEnforceMessage = { userId, blockedUserId };
    try {
      await this.redis.publish(BLOCK_ENFORCE_CHANNEL, JSON.stringify(message));
    } catch (err) {
      this.logger.warn(
        `Failed to publish block-enforce for ${userId}→${blockedUserId}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
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

  /**
   * List blocks created BY `userId` (the rows this user owns), newest first,
   * EACH enriched with the blocked user's minimal public identity (nickname +
   * avatar) so the blocklist UI is readable rather than showing a raw hex id.
   *
   * The profile join is a single batched `$in` over the `profiles` collection
   * (read through the shared {@link Connection} by collection name — the same
   * escape hatch {@link AdminService} uses — so this stays free of a hard
   * ProfilesModule dependency and adds no N+1). A blocked user whose profile is
   * missing/deleted falls back to an empty `nickname` + `null` `avatarUrl`; the
   * block row itself is always returned.
   */
  async listOwnBlocks(userId: string): Promise<BlockedUserContract[]> {
    const rows = await this.blockModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .exec();

    const identities = await this.loadIdentities(rows.map((row) => row.blockedUserId));
    return rows.map((row) =>
      this.toBlockedUser(row, identities.get(row.blockedUserId.toString())),
    );
  }

  /**
   * Batch-load `userId → { nickname, avatarUrl }` from `profiles` in ONE `$in`
   * query. Missing profiles are simply absent from the map (caller falls back).
   */
  private async loadIdentities(
    userIds: readonly Types.ObjectId[],
  ): Promise<Map<string, ProfileIdentity>> {
    const out = new Map<string, ProfileIdentity>();
    if (userIds.length === 0) {
      return out;
    }
    const docs = await this.connection
      .collection('profiles')
      .find(
        { userId: { $in: userIds as Types.ObjectId[] } },
        { projection: { userId: 1, nickname: 1, avatarUrl: 1 } },
      )
      .toArray();
    for (const doc of docs) {
      const p = doc as unknown as {
        userId: Types.ObjectId;
        nickname?: string;
        avatarUrl?: string | null;
      };
      out.set(p.userId.toString(), {
        nickname: p.nickname ?? '',
        avatarUrl: p.avatarUrl ?? null,
      });
    }
    return out;
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

  /**
   * Map a hydrated block + its (optional) joined identity to the enriched
   * {@link BlockedUserContract}. A missing identity degrades to an empty
   * nickname + null avatar, never a throw.
   */
  private toBlockedUser(doc: BlockDocument, identity?: ProfileIdentity): BlockedUserContract {
    return {
      ...this.toContract(doc),
      nickname: identity?.nickname ?? '',
      avatarUrl: identity?.avatarUrl ?? null,
    };
  }
}
