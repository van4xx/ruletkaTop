import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, type QueryFilter, Types } from 'mongoose';

import type {
  ChatRejectReason,
  Conversation as ConversationContract,
  Message as MessageContract,
  MessageType,
  MinimalProfile,
  PaginationQuery,
  Visibility,
} from '@ruletka/shared-types';

/** A page of conversations (most-recently-active first) plus an opaque cursor. */
export interface ConversationPage {
  items: ConversationContract[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Opaque keyset cursor for the conversation list. Encodes the compound sort
 * key `(lastMessageAt, _id)` so paging is stable even when `lastMessageAt`
 * ties (or is null). Serialised as base64url JSON.
 */
interface ConversationCursor {
  /** `lastMessageAt` epoch ms, or `null` for an empty (never-messaged) thread. */
  t: number | null;
  /** Conversation `_id` hex string (the unique tiebreak). */
  id: string;
}

import { BlocksService } from '../moderation/blocks.service';
import { FriendsService } from '../friends/friends.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActiveConversationService } from './active-conversation.service';
import {
  buildConversationPairKey,
  Conversation,
  ConversationDocument,
} from './schemas/conversation.schema';
import { Message, MessageDocument } from './schemas/message.schema';

/** Max characters kept in a conversation's denormalised preview. */
const PREVIEW_MAX = 120;

/** Input accepted by {@link ChatService.sendMessage}. */
export interface SendMessageInput {
  conversationId?: string;
  recipientId?: string;
  type?: MessageType;
  content: string;
}

/** Result of persisting a message: the row plus delivery routing metadata. */
export interface SentMessage {
  message: MessageContract;
  conversationId: string;
  /** The OTHER participant — the room the gateway should emit to. */
  recipientId: string;
}

/** A page of messages (newest-first) with an opaque cursor for the next page. */
export interface MessagePage {
  items: MessageContract[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Owns the `conversations` and `messages` collections and all direct-message
 * logic: conversation resolution (one per unordered pair), delivery gating
 * (block + friendship + recipient privacy), persistence, unread counting and
 * read receipts.
 *
 * Delivery gating consumes {@link BlocksService} and {@link FriendsService};
 * the recipient's `whoCanMessage` privacy is read directly from the
 * `settings` collection (owned by the settings module, which does not export
 * its service) to avoid a hard DI dependency.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly friendsService: FriendsService,
    private readonly blocksService: BlocksService,
    private readonly notificationsService: NotificationsService,
    private readonly activeConversations: ActiveConversationService,
  ) {}

  /**
   * A page of the caller's conversations, most-recently-active first, each
   * carrying the caller's unread count (messages not authored by them and not
   * yet read).
   *
   * Cursor-paginated on the compound `(lastMessageAt, _id)` key (keyset, not
   * offset, so it stays correct as threads reorder). Unread counts for the
   * WHOLE page are computed in a SINGLE `$group` aggregation rather than one
   * `countDocuments` per row (kills the previous N+1).
   */
  async listConversations(userId: string, pagination: PaginationQuery): Promise<ConversationPage> {
    if (!Types.ObjectId.isValid(userId)) {
      return { items: [], nextCursor: null, hasMore: false };
    }
    const id = new Types.ObjectId(userId);

    const filter: QueryFilter<ConversationDocument> = { participants: id };
    const cursor = decodeConversationCursor(pagination.cursor);
    if (pagination.cursor && !cursor) {
      // Unparseable cursor → terminal empty page rather than a 500.
      return { items: [], nextCursor: null, hasMore: false };
    }
    if (cursor) {
      Object.assign(filter, buildConversationKeysetFilter(cursor));
    }

    // Fetch one extra row to determine `hasMore` without a second query.
    const rows = await this.conversationModel
      .find(filter)
      .sort({ lastMessageAt: -1, _id: -1 })
      .limit(pagination.limit + 1)
      .exec();

    const hasMore = rows.length > pagination.limit;
    const page = hasMore ? rows.slice(0, pagination.limit) : rows;

    const unreadByConversation = await this.unreadCountsFor(id, page);

    const items = page.map((row) =>
      this.toConversationContract(row, unreadByConversation.get(row._id.toString()) ?? 0),
    );
    const last = page.at(-1);

    return {
      items,
      nextCursor: hasMore && last ? encodeConversationCursor(last) : null,
      hasMore,
    };
  }

  /**
   * Unread counts for the caller across an entire page of conversations in ONE
   * round-trip: a single `$group` over the page's messages (not authored by the
   * caller, unread), returned as a `conversationId → count` map.
   */
  private async unreadCountsFor(
    userId: Types.ObjectId,
    page: readonly ConversationDocument[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (page.length === 0) {
      return counts;
    }
    const conversationIds = page.map((row) => row._id);
    const grouped = await this.messageModel
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            conversationId: { $in: conversationIds },
            senderId: { $ne: userId },
            readAt: null,
          },
        },
        { $group: { _id: '$conversationId', count: { $sum: 1 } } },
      ])
      .exec();
    for (const row of grouped) {
      counts.set(row._id.toString(), row.count);
    }
    return counts;
  }

  /**
   * Cursor-paginated messages of a conversation, newest-first. The caller must
   * be a participant. The `cursor` is the `_id` of the last item from the
   * previous page (fetch older messages with `_id < cursor`).
   */
  async getMessages(
    conversationId: string,
    userId: string,
    pagination: PaginationQuery,
  ): Promise<MessagePage> {
    const conversation = await this.findConversationOr404(conversationId);
    this.assertParticipant(conversation, userId);

    const filter: QueryFilter<MessageDocument> = { conversationId: conversation._id };
    if (pagination.cursor) {
      if (!Types.ObjectId.isValid(pagination.cursor)) {
        // An invalid cursor yields an empty (terminal) page rather than a 500.
        return { items: [], nextCursor: null, hasMore: false };
      }
      filter._id = { $lt: new Types.ObjectId(pagination.cursor) };
    }

    // Fetch one extra row to determine `hasMore` without a second query.
    const rows = await this.messageModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(pagination.limit + 1)
      .exec();

    const hasMore = rows.length > pagination.limit;
    const page = hasMore ? rows.slice(0, pagination.limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map((row) => this.toMessageContract(row)),
      nextCursor: hasMore && last ? last._id.toString() : null,
      hasMore,
    };
  }

  /**
   * Persist a message, creating the conversation on first contact. Resolves the
   * recipient from either `conversationId` or `recipientId`, enforces the
   * delivery gate (not blocked; friends OR recipient privacy allows it), then
   * updates the conversation's denormalised preview / activity timestamp.
   */
  async sendMessage(senderId: string, input: SendMessageInput): Promise<SentMessage> {
    const { conversation, recipientId } = await this.resolveConversation(senderId, input);
    await this.assertCanMessage(senderId, recipientId);

    const type: MessageType = input.type ?? 'text';
    const created = await this.messageModel.create({
      conversationId: conversation._id,
      senderId: new Types.ObjectId(senderId),
      type,
      content: input.content,
      readAt: null,
    });

    const createdAt: Date = created.get('createdAt');
    const preview = this.buildPreview(type, input.content);
    await this.conversationModel
      .updateOne(
        { _id: conversation._id },
        {
          $set: {
            lastMessageAt: createdAt,
            lastMessagePreview: preview,
          },
        },
      )
      .exec();

    // Best-effort: notify the recipient if they're not currently in this thread.
    await this.notifyRecipientIfAway(senderId, recipientId, conversation._id.toString(), preview);

    return {
      message: this.toMessageContract(created),
      conversationId: conversation._id.toString(),
      recipientId,
    };
  }

  /**
   * Raise a `message` notification for the recipient UNLESS they are actively
   * looking at this conversation right now (a live focus marker on the thread).
   * A recipient who is away — offline, or online but reading a DIFFERENT thread —
   * gets an in-app notification deep-linking to `/chat/<conversationId>`; the
   * notification itself fans out a push (it persists, emits `notif:new`, pushes).
   *
   * Strictly best-effort: any failure (including the active-conversation lookup)
   * is swallowed so a delivery-side hiccup never fails the send. The notification
   * body reuses the conversation preview already computed for the inbox.
   */
  private async notifyRecipientIfAway(
    senderId: string,
    recipientId: string,
    conversationId: string,
    preview: string,
  ): Promise<void> {
    try {
      if (await this.activeConversations.isActiveIn(recipientId, conversationId)) {
        // Recipient is reading THIS thread — the live `chat:message` echo is
        // enough; an in-app notification would be noise.
        return;
      }
      const senderName = await this.nicknameOf(senderId);
      await this.notificationsService.create({
        recipientUserId: recipientId,
        kind: 'message',
        title: senderName,
        body: preview,
        actorId: senderId,
        link: `/chat/${conversationId}`,
      });
    } catch (err) {
      this.logger.debug(`message notification failed: ${asMessage(err)}`);
    }
  }

  /**
   * Resolve a user's display nickname from the `profiles` collection (read by
   * name, like {@link getWhoCanMessage} reads `settings`). Falls back to
   * "Someone" so a notification title is always sensible.
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

  /**
   * Mark messages in a conversation as read by `userId` UP TO AND INCLUDING
   * `messageId` (only messages the caller did NOT author). Idempotent. Returns
   * the other participant so the caller can relay a read receipt.
   */
  async markRead(
    conversationId: string,
    userId: string,
    messageId: string,
  ): Promise<{ recipientId: string }> {
    const conversation = await this.findConversationOr404(conversationId);
    this.assertParticipant(conversation, userId);

    if (Types.ObjectId.isValid(messageId)) {
      await this.messageModel
        .updateMany(
          {
            conversationId: conversation._id,
            senderId: { $ne: new Types.ObjectId(userId) },
            readAt: null,
            _id: { $lte: new Types.ObjectId(messageId) },
          },
          { $set: { readAt: new Date() } },
        )
        .exec();
    }

    return { recipientId: this.otherParticipant(conversation, userId) };
  }

  /**
   * The other participant of a conversation the caller belongs to (read-only;
   * used by the gateway to relay typing indicators). Throws `404`/`403` if the
   * conversation is missing or the caller is not a participant.
   */
  async getOtherParticipant(conversationId: string, userId: string): Promise<string> {
    const conversation = await this.findConversationOr404(conversationId);
    this.assertParticipant(conversation, userId);
    return this.otherParticipant(conversation, userId);
  }

  /**
   * MINIMAL identity (nickname + avatar) of a user the caller ALREADY shares a
   * conversation with — even when that user's `whoCanViewProfile` privacy would
   * 404 their full public profile. The shared-conversation check is the
   * entitlement: you have already been talking, so a nameless, faceless thread
   * (the previous behaviour, where `GET /profiles/:id` 404'd) is the wrong
   * trade-off. Throws `404` only when no shared conversation exists or the
   * target's profile row is genuinely missing.
   *
   * Reads the `profiles` collection directly (projected to the minimal fields),
   * mirroring how {@link nicknameOf} and the friends module read it — so no
   * profiles-module dependency or visibility gate is involved.
   */
  async getConversationPeerIdentity(userId: string, peerId: string): Promise<MinimalProfile> {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(peerId)) {
      throw new NotFoundException('Profile not found');
    }
    const pairKey = buildConversationPairKey(userId, peerId);
    const shared = await this.conversationModel.exists({ pairKey }).exec();
    if (!shared) {
      // No established conversation → no entitlement to even the minimal identity.
      throw new NotFoundException('Profile not found');
    }
    const doc = await this.connection
      .collection('profiles')
      .findOne(
        { userId: new Types.ObjectId(peerId) },
        { projection: { userId: 1, nickname: 1, avatarUrl: 1 } },
      );
    if (!doc) {
      throw new NotFoundException('Profile not found');
    }
    const profile = doc as unknown as {
      userId: Types.ObjectId;
      nickname?: string;
      avatarUrl?: string | null;
    };
    return {
      id: profile.userId.toString(),
      nickname: profile.nickname ?? '',
      avatarUrl: profile.avatarUrl ?? null,
    };
  }

  /**
   * Whether `senderId` is currently allowed to message `recipientId`. Combines
   * the block gate and the recipient's `whoCanMessage` privacy. Exposed for the
   * gateway to pre-check before persisting.
   */
  async canMessage(senderId: string, recipientId: string): Promise<boolean> {
    if (await this.blocksService.isBlocked(senderId, recipientId)) {
      return false;
    }
    const visibility = await this.getWhoCanMessage(recipientId);
    if (visibility === 'nobody') {
      return false;
    }
    if (visibility === 'friends') {
      return this.friendsService.areFriends(senderId, recipientId);
    }
    return true; // 'everyone'
  }

  /**
   * Best-effort classification of WHY a `chat:message` send failed, for the
   * realtime `chat:rejected` ack. Re-derives the precise reason from the same
   * block / privacy / resolution checks `sendMessage` runs, WITHOUT throwing:
   *
   *  - `not_found`  — the conversation / recipient can't be resolved (or is self);
   *  - `blocked`    — a block exists in either direction;
   *  - `privacy`    — the recipient's `whoCanMessage` forbids it;
   *  - `error`      — none of the above matched (an unexpected failure).
   *
   * Runs ONLY on the already-failed path, so the extra resolution round-trip
   * never touches a successful send. It never mutates state (resolution here is
   * read-only: it looks the conversation up but, unlike {@link sendMessage},
   * does not create one).
   */
  async classifyRejection(senderId: string, input: SendMessageInput): Promise<ChatRejectReason> {
    const recipientId = await this.resolveRecipientReadOnly(senderId, input);
    if (!recipientId) {
      return 'not_found';
    }
    if (await this.blocksService.isBlocked(senderId, recipientId)) {
      return 'blocked';
    }
    const visibility = await this.getWhoCanMessage(recipientId);
    if (visibility === 'nobody') {
      return 'privacy';
    }
    if (visibility === 'friends' && !(await this.friendsService.areFriends(senderId, recipientId))) {
      return 'privacy';
    }
    return 'error';
  }

  /**
   * Resolve the recipient id for an outgoing message WITHOUT creating a
   * conversation (the read-only counterpart of {@link resolveConversation},
   * used by {@link classifyRejection}). Returns `null` when the recipient can't
   * be determined: an unknown / non-participant conversation, a missing/invalid
   * `recipientId`, or a self-send.
   */
  private async resolveRecipientReadOnly(
    senderId: string,
    input: SendMessageInput,
  ): Promise<string | null> {
    if (input.conversationId) {
      if (!Types.ObjectId.isValid(input.conversationId)) {
        return null;
      }
      const conversation = await this.conversationModel.findById(input.conversationId).exec();
      if (!conversation || !conversation.participants.some((p) => p.toString() === senderId)) {
        return null;
      }
      return this.otherParticipant(conversation, senderId);
    }
    const recipientId = input.recipientId;
    if (!recipientId || !Types.ObjectId.isValid(recipientId) || recipientId === senderId) {
      return null;
    }
    return recipientId;
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Throw `403` if `senderId` may not message `recipientId`. */
  private async assertCanMessage(senderId: string, recipientId: string): Promise<void> {
    if (!(await this.canMessage(senderId, recipientId))) {
      throw new ForbiddenException('You are not allowed to message this user');
    }
  }

  /**
   * Resolve (and lazily create) the conversation for an outgoing message,
   * returning it together with the resolved recipient id. Validates that the
   * sender is a participant when an explicit `conversationId` is supplied.
   */
  private async resolveConversation(
    senderId: string,
    input: SendMessageInput,
  ): Promise<{ conversation: ConversationDocument; recipientId: string }> {
    if (input.conversationId) {
      const conversation = await this.findConversationOr404(input.conversationId);
      this.assertParticipant(conversation, senderId);
      return { conversation, recipientId: this.otherParticipant(conversation, senderId) };
    }

    const recipientId = input.recipientId;
    if (!recipientId || !Types.ObjectId.isValid(recipientId)) {
      throw new NotFoundException('recipientId or conversationId is required');
    }
    if (recipientId === senderId) {
      throw new ForbiddenException('Cannot message yourself');
    }
    const conversation = await this.getOrCreateConversation(senderId, recipientId);
    return { conversation, recipientId };
  }

  /** Find an existing pair conversation or create it (idempotent on the pair). */
  private async getOrCreateConversation(a: string, b: string): Promise<ConversationDocument> {
    const pairKey = buildConversationPairKey(a, b);
    // Upsert on the unique pairKey: concurrent first-messages converge on one row.
    return this.conversationModel
      .findOneAndUpdate(
        { pairKey },
        {
          $setOnInsert: {
            pairKey,
            participants: [new Types.ObjectId(a), new Types.ObjectId(b)],
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  /** Read the recipient's `whoCanMessage` privacy (defaulting to `everyone`). */
  private async getWhoCanMessage(userId: string): Promise<Visibility> {
    if (!Types.ObjectId.isValid(userId)) {
      return 'everyone';
    }
    const doc = await this.connection
      .collection('settings')
      .findOne(
        { userId: new Types.ObjectId(userId) },
        { projection: { 'privacy.whoCanMessage': 1 } },
      );
    const value = (doc?.privacy as { whoCanMessage?: Visibility } | undefined)?.whoCanMessage;
    return value ?? 'everyone';
  }

  /** Build a trimmed preview string for the conversation inbox. */
  private buildPreview(type: MessageType, content: string): string {
    if (type === 'image') {
      return '📷 Photo';
    }
    if (type === 'gift') {
      return '🎁 Gift';
    }
    const trimmed = content.trim();
    return trimmed.length > PREVIEW_MAX ? `${trimmed.slice(0, PREVIEW_MAX)}…` : trimmed;
  }

  /** Load a conversation by id or throw `404`. */
  private async findConversationOr404(conversationId: string): Promise<ConversationDocument> {
    if (!Types.ObjectId.isValid(conversationId)) {
      throw new NotFoundException('Conversation not found');
    }
    const doc = await this.conversationModel.findById(conversationId).exec();
    if (!doc) {
      throw new NotFoundException('Conversation not found');
    }
    return doc;
  }

  /** Throw `403` if `userId` is not a participant of the conversation. */
  private assertParticipant(conversation: ConversationDocument, userId: string): void {
    const isParticipant = conversation.participants.some((p) => p.toString() === userId);
    if (!isParticipant) {
      throw new ForbiddenException('Not a participant of this conversation');
    }
  }

  /** The participant that is NOT `userId`. Assumes `userId` is a participant. */
  private otherParticipant(conversation: ConversationDocument, userId: string): string {
    const other =
      conversation.participants.find((p) => p.toString() !== userId) ??
      conversation.participants[0];
    // A well-formed 1:1 conversation always has a distinct other participant;
    // the fallback guards a (malformed) single-participant row defensively.
    if (!other) {
      throw new NotFoundException('Conversation has no participants');
    }
    return other.toString();
  }

  /** Map a conversation document + viewer-specific unread count to the contract. */
  private toConversationContract(
    doc: ConversationDocument,
    unreadCount: number,
  ): ConversationContract {
    return {
      id: doc._id.toString(),
      participants: doc.participants.map((p) => p.toString()),
      lastMessageAt: doc.lastMessageAt ? doc.lastMessageAt.toISOString() : null,
      lastMessagePreview: doc.lastMessagePreview,
      unreadCount,
    };
  }

  /** Map a message document to the shared `Message` contract shape. */
  private toMessageContract(doc: MessageDocument): MessageContract {
    return {
      id: doc._id.toString(),
      conversationId: doc.conversationId.toString(),
      senderId: doc.senderId.toString(),
      type: doc.type,
      content: doc.content,
      readAt: doc.readAt ? doc.readAt.toISOString() : null,
      createdAt: doc.get('createdAt').toISOString(),
    };
  }
}

/** Narrows an unknown thrown value to a printable message. */
function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Encode a conversation row's sort key into an opaque (base64url) cursor. */
function encodeConversationCursor(doc: ConversationDocument): string {
  const cursor: ConversationCursor = {
    t: doc.lastMessageAt ? doc.lastMessageAt.getTime() : null,
    id: doc._id.toString(),
  };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Decode an opaque conversation cursor, or `null` if malformed. */
function decodeConversationCursor(raw: string | undefined): ConversationCursor | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<ConversationCursor>;
    if (
      typeof parsed.id !== 'string' ||
      !Types.ObjectId.isValid(parsed.id) ||
      !(typeof parsed.t === 'number' || parsed.t === null)
    ) {
      return null;
    }
    return { t: parsed.t, id: parsed.id };
  } catch {
    return null;
  }
}

/**
 * Build the keyset filter for "strictly after `cursor`" under a
 * `lastMessageAt DESC, _id DESC` sort.
 *
 * For a non-null cursor timestamp `t` the next page is everything with
 * `lastMessageAt < t`, plus the rows with the SAME `lastMessageAt === t` whose
 * `_id` is smaller (the within-tie tail). When the cursor sits on a NULL
 * `lastMessageAt` (empty threads, which sort last) we page purely by `_id`
 * among the remaining nulls.
 */
function buildConversationKeysetFilter(
  cursor: ConversationCursor,
): QueryFilter<ConversationDocument> {
  const cursorId = new Types.ObjectId(cursor.id);
  if (cursor.t === null) {
    // Already in the trailing null-`lastMessageAt` block: continue by _id only.
    return { lastMessageAt: null, _id: { $lt: cursorId } };
  }
  const boundary = new Date(cursor.t);
  return {
    $or: [
      { lastMessageAt: { $lt: boundary } },
      // Null timestamps sort AFTER any real timestamp in a DESC order.
      { lastMessageAt: null },
      { lastMessageAt: boundary, _id: { $lt: cursorId } },
    ],
  };
}
