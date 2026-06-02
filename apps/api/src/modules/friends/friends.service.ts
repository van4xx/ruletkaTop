import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, type QueryFilter, Types } from 'mongoose';

import type {
  FriendRequestItem,
  FriendRequestsResponse,
  FriendSummary,
  Friendship as FriendshipContract,
  PaginationQuery,
} from '@ruletka/shared-types';

import { NotificationsService } from '../notifications/notifications.service';
import { PresenceService } from '../presence/presence.service';
import { buildPairKey, Friendship, FriendshipDocument } from './schemas/friendship.schema';

/** A page of friend summaries (newest friendships first) plus an opaque cursor. */
export interface FriendPage {
  items: FriendSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Minimal profile fields a {@link FriendSummary} needs (mirrors the
 * `friendSummarySchema.pick`). Read in one `$in` batch from the `profiles`
 * collection rather than per-friend.
 */
interface MinimalFriendProfile {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  isPremium: boolean;
  badges: FriendSummary['profile']['badges'];
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
 * Owns the `friendships` collection and the friend-list read model.
 *
 * A friendship is unordered (one row per pair) but keeps direction so only the
 * recipient can accept. Friend summaries are composed from a batched read of
 * the `profiles` collection (minimal projection) and {@link PresenceService}
 * (live online status).
 *
 * Exported cross-module: {@link areFriends} — the chat gate and call gate use
 * it to decide whether two users may interact.
 */
@Injectable()
export class FriendsService {
  private readonly logger = new Logger(FriendsService.name);

  constructor(
    @InjectModel(Friendship.name)
    private readonly friendshipModel: Model<FriendshipDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly presenceService: PresenceService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Send a friend request from `requesterId` to `recipientId`.
   *
   * Rejects self-requests. If a relationship already exists for the pair it is
   * surfaced as a `409` conflict (whether pending, accepted or blocked) so the
   * caller can't create duplicates or silently re-request.
   */
  async sendRequest(requesterId: string, recipientId: string): Promise<FriendshipContract> {
    if (requesterId === recipientId) {
      throw new BadRequestException('Cannot friend yourself');
    }
    if (!Types.ObjectId.isValid(recipientId)) {
      throw new BadRequestException('Invalid recipientId');
    }

    try {
      const created = await this.friendshipModel.create({
        requesterId: new Types.ObjectId(requesterId),
        recipientId: new Types.ObjectId(recipientId),
        status: 'pending',
        pairKey: buildPairKey(requesterId, recipientId),
      });
      // Notify the recipient they have a new friend request (best-effort).
      await this.notifyFriendRequest(requesterId, recipientId, created._id.toString());
      return this.toContract(created);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictException('Friendship already exists');
      }
      throw err;
    }
  }

  /**
   * Accept a pending request. Only the original RECIPIENT may accept, and only
   * while the request is still `pending`. Returns the updated friendship.
   */
  async acceptRequest(friendshipId: string, userId: string): Promise<FriendshipContract> {
    const doc = await this.findByIdOr404(friendshipId);

    if (doc.recipientId.toString() !== userId) {
      throw new ForbiddenException('Only the recipient can accept this request');
    }
    if (doc.status !== 'pending') {
      throw new ConflictException(`Cannot accept a ${doc.status} friendship`);
    }

    doc.status = 'accepted';
    await doc.save();
    // Notify the ORIGINAL requester that their request was accepted (the
    // acceptor is `userId`; the actor on the notification is the acceptor).
    await this.notifyRequestAccepted(userId, doc.requesterId.toString());
    return this.toContract(doc);
  }

  /**
   * Remove a friendship / decline a request. Either participant may remove it.
   * Idempotent at the API edge (a missing row yields `404`, handled by callers).
   */
  async removeFriendship(friendshipId: string, userId: string): Promise<void> {
    const doc = await this.findByIdOr404(friendshipId);
    if (doc.requesterId.toString() !== userId && doc.recipientId.toString() !== userId) {
      throw new ForbiddenException('Not a participant of this friendship');
    }
    await this.friendshipModel.deleteOne({ _id: doc._id }).exec();
  }

  /**
   * A page of the caller's accepted friends as {@link FriendSummary}[] — minimal
   * profile plus live online status, newest friendships first. Friends whose
   * profile can't be resolved are skipped (a deleted profile shouldn't break the
   * whole list).
   *
   * Cursor-paginated on the friendship's `(createdAt, _id)` key (keyset). Both
   * the profile reads (one `$in`) and the presence lookup (one `mget`) are
   * batched, eliminating the previous per-friend N+1.
   */
  async listFriends(userId: string, pagination: PaginationQuery): Promise<FriendPage> {
    if (!Types.ObjectId.isValid(userId)) {
      return { items: [], nextCursor: null, hasMore: false };
    }
    const id = new Types.ObjectId(userId);

    const filter: QueryFilter<FriendshipDocument> = {
      status: 'accepted',
      $and: [{ $or: [{ requesterId: id }, { recipientId: id }] }],
    };
    const cursor = decodeFriendCursor(pagination.cursor);
    if (pagination.cursor && !cursor) {
      return { items: [], nextCursor: null, hasMore: false };
    }
    if (cursor) {
      // AND the keyset predicate alongside the participant predicate so the two
      // `$or`/compound clauses don't clobber each other.
      (filter.$and as QueryFilter<FriendshipDocument>[]).push(buildFriendKeysetFilter(cursor));
    }

    // Fetch one extra row to determine `hasMore` without a second query.
    const rows = await this.friendshipModel
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(pagination.limit + 1)
      .exec();

    const hasMore = rows.length > pagination.limit;
    const page = hasMore ? rows.slice(0, pagination.limit) : rows;

    // The "other" participant of each friendship on this page.
    const friendIds = page.map((row) =>
      row.requesterId.toString() === userId
        ? row.recipientId.toString()
        : row.requesterId.toString(),
    );

    // Two batched round-trips: presence (mget) and profiles ($in).
    const [statuses, profiles] = await Promise.all([
      this.presenceService.getStatuses(friendIds),
      this.loadMinimalProfiles(friendIds),
    ]);

    const items: FriendSummary[] = [];
    for (const row of page) {
      const friendId =
        row.requesterId.toString() === userId
          ? row.recipientId.toString()
          : row.requesterId.toString();
      const profile = profiles.get(friendId);
      if (!profile) {
        // Skip friends whose profile no longer resolves.
        continue;
      }
      items.push({
        friendshipId: row._id.toString(),
        profile,
        status: statuses[friendId] ?? 'offline',
        since: row.get('createdAt').toISOString(),
      });
    }

    const last = page.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodeFriendCursor(last) : null,
      hasMore,
    };
  }

  /**
   * The caller's PENDING friend requests, split by direction:
   * - `incoming` — someone sent the caller a request (the caller may accept /
   *   decline it);
   * - `outgoing` — the caller sent a request that is still awaiting acceptance.
   *
   * Both lists are newest-first and each item carries the OTHER user's minimal
   * profile (resolved in ONE batched `$in` read against `profiles`, exactly like
   * {@link listFriends}, so there is no per-request N+1). Requests whose other
   * party's profile no longer resolves are skipped rather than crashing the list.
   *
   * This is intentionally NOT paginated: pending-request volume per user is
   * small and bounded, and the requests surface shows both directions at once.
   */
  async listRequests(userId: string): Promise<FriendRequestsResponse> {
    if (!Types.ObjectId.isValid(userId)) {
      return { incoming: [], outgoing: [] };
    }
    const id = new Types.ObjectId(userId);

    // One query for both directions; `_id` is the tiebreak under the DESC sort.
    const rows = await this.friendshipModel
      .find({
        status: 'pending',
        $or: [{ requesterId: id }, { recipientId: id }],
      })
      .sort({ createdAt: -1, _id: -1 })
      .exec();

    // The "other" participant of every pending row, resolved in a single batch.
    const otherIds = rows.map((row) =>
      row.requesterId.toString() === userId
        ? row.recipientId.toString()
        : row.requesterId.toString(),
    );
    const profiles = await this.loadMinimalProfiles(otherIds);

    const incoming: FriendRequestItem[] = [];
    const outgoing: FriendRequestItem[] = [];
    for (const row of rows) {
      // `incoming` when the caller RECEIVED the request; `outgoing` when sent.
      const isIncoming = row.recipientId.toString() === userId;
      const otherId = isIncoming ? row.requesterId.toString() : row.recipientId.toString();
      const profile = profiles.get(otherId);
      if (!profile) {
        // Skip requests whose counterpart profile no longer resolves.
        continue;
      }
      const item: FriendRequestItem = {
        friendshipId: row._id.toString(),
        profile,
        direction: isIncoming ? 'incoming' : 'outgoing',
        createdAt: row.get('createdAt').toISOString(),
      };
      (isIncoming ? incoming : outgoing).push(item);
    }

    return { incoming, outgoing };
  }

  /**
   * Batch-load the minimal profile fields for a set of friend ids in ONE `$in`
   * query against the `profiles` collection, returned as `userId → profile`.
   * Reads the collection directly (projected) rather than via per-id
   * `ProfilesService` calls, mirroring how chat reads `settings` directly.
   */
  private async loadMinimalProfiles(
    friendIds: readonly string[],
  ): Promise<Map<string, MinimalFriendProfile>> {
    const out = new Map<string, MinimalFriendProfile>();
    if (friendIds.length === 0) {
      return out;
    }
    const objectIds = friendIds
      .filter((fid) => Types.ObjectId.isValid(fid))
      .map((fid) => new Types.ObjectId(fid));

    const docs = await this.connection
      .collection('profiles')
      .find(
        { userId: { $in: objectIds } },
        { projection: { userId: 1, nickname: 1, avatarUrl: 1, isPremium: 1, badges: 1 } },
      )
      .toArray();

    for (const doc of docs) {
      const profileDoc = doc as unknown as {
        userId: Types.ObjectId;
        nickname?: string;
        avatarUrl?: string | null;
        isPremium?: boolean;
        badges?: MinimalFriendProfile['badges'];
      };
      out.set(profileDoc.userId.toString(), {
        id: profileDoc.userId.toString(),
        nickname: profileDoc.nickname ?? '',
        avatarUrl: profileDoc.avatarUrl ?? null,
        isPremium: profileDoc.isPremium ?? false,
        badges: profileDoc.badges ?? [],
      });
    }
    return out;
  }

  /**
   * Whether `a` and `b` have an ACCEPTED friendship. Order-independent; returns
   * `false` for invalid ids so callers can use it as a cheap gate.
   */
  async areFriends(a: string, b: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(a) || !Types.ObjectId.isValid(b) || a === b) {
      return false;
    }
    const existing = await this.friendshipModel
      .exists({ pairKey: buildPairKey(a, b), status: 'accepted' })
      .exec();
    return existing !== null;
  }

  // ── Notifications (best-effort side-effects) ─────────────────────────────────

  /**
   * Raise a `friend_request` notification for the recipient of a new request.
   * Best-effort: a failure is logged, never thrown (it must not roll back the
   * friendship create or be mistaken for the duplicate-key conflict).
   */
  private async notifyFriendRequest(
    requesterId: string,
    recipientId: string,
    friendshipId: string,
  ): Promise<void> {
    try {
      const nickname = await this.nicknameOf(requesterId);
      await this.notificationsService.create({
        recipientUserId: recipientId,
        kind: 'friend_request',
        title: 'New friend request',
        body: `${nickname} wants to be your friend`,
        actorId: requesterId,
        // Deep link to the incoming-requests surface.
        link: '/friends/requests',
      });
    } catch (err) {
      this.logger.debug(`friend-request notification failed (${friendshipId}): ${asMessage(err)}`);
    }
  }

  /**
   * Raise a `friend_request` notification for the original requester when their
   * request is accepted. Best-effort (see {@link notifyFriendRequest}).
   */
  private async notifyRequestAccepted(acceptorId: string, requesterId: string): Promise<void> {
    try {
      const nickname = await this.nicknameOf(acceptorId);
      await this.notificationsService.create({
        recipientUserId: requesterId,
        kind: 'friend_request',
        title: 'Friend request accepted',
        body: `${nickname} accepted your friend request`,
        actorId: acceptorId,
        link: `/profile/${acceptorId}`,
      });
    } catch (err) {
      this.logger.debug(`accept notification failed: ${asMessage(err)}`);
    }
  }

  /**
   * Resolve a user's display nickname from the `profiles` collection (read by
   * name, like {@link loadMinimalProfiles}). Falls back to "Someone" when the
   * profile can't be resolved, so a notification body is always sensible.
   */
  private async nicknameOf(userId: string): Promise<string> {
    if (!Types.ObjectId.isValid(userId)) {
      return 'Someone';
    }
    const doc = await this.connection
      .collection('profiles')
      .findOne({ userId: new Types.ObjectId(userId) }, { projection: { nickname: 1 } });
    const nickname = (doc as { nickname?: string } | null)?.nickname;
    return nickname && nickname.length > 0 ? nickname : 'Someone';
  }

  /** Load a friendship by id or throw `404`. */
  private async findByIdOr404(friendshipId: string): Promise<FriendshipDocument> {
    if (!Types.ObjectId.isValid(friendshipId)) {
      throw new NotFoundException('Friendship not found');
    }
    const doc = await this.friendshipModel.findById(friendshipId).exec();
    if (!doc) {
      throw new NotFoundException('Friendship not found');
    }
    return doc;
  }

  /** Map a hydrated friendship document to the shared contract shape. */
  private toContract(doc: FriendshipDocument): FriendshipContract {
    return {
      id: doc._id.toString(),
      requesterId: doc.requesterId.toString(),
      recipientId: doc.recipientId.toString(),
      status: doc.status,
      createdAt: doc.get('createdAt').toISOString(),
    };
  }
}

/** Narrows an unknown thrown value to a printable message. */
function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Opaque keyset cursor for the friends list, encoding the friendship's
 * `(createdAt, _id)` sort key (base64url JSON) so paging is stable across ties.
 */
interface FriendCursor {
  /** `createdAt` epoch ms. */
  t: number;
  /** Friendship `_id` hex string (unique tiebreak). */
  id: string;
}

/** Encode a friendship row's sort key into an opaque cursor. */
function encodeFriendCursor(doc: FriendshipDocument): string {
  const cursor: FriendCursor = {
    t: (doc.get('createdAt') as Date).getTime(),
    id: doc._id.toString(),
  };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Decode an opaque friend cursor, or `null` if malformed. */
function decodeFriendCursor(raw: string | undefined): FriendCursor | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<FriendCursor>;
    if (
      typeof parsed.t !== 'number' ||
      typeof parsed.id !== 'string' ||
      !Types.ObjectId.isValid(parsed.id)
    ) {
      return null;
    }
    return { t: parsed.t, id: parsed.id };
  } catch {
    return null;
  }
}

/**
 * Keyset predicate for "strictly after `cursor`" under a
 * `createdAt DESC, _id DESC` sort: older `createdAt`, or the same `createdAt`
 * with a smaller `_id`.
 */
function buildFriendKeysetFilter(cursor: FriendCursor): QueryFilter<FriendshipDocument> {
  const boundary = new Date(cursor.t);
  const cursorId = new Types.ObjectId(cursor.id);
  return {
    $or: [{ createdAt: { $lt: boundary } }, { createdAt: boundary, _id: { $lt: cursorId } }],
  };
}
