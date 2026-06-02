import { Types } from 'mongoose';

import type { PaginationQuery } from '@ruletka/shared-types';

import type { BlocksService } from '../moderation/blocks.service';
import type { FriendsService } from '../friends/friends.service';
import { ChatService } from './chat.service';
import type { ConversationDocument } from './schemas/conversation.schema';
import type { MessageDocument } from './schemas/message.schema';

/** Build a stand-in conversation document. */
function conversationDoc(over: {
  id: string;
  lastMessageAt: Date | null;
  preview?: string | null;
  participants?: string[];
}): ConversationDocument {
  return {
    _id: new Types.ObjectId(over.id),
    participants: (
      over.participants ?? ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012']
    ).map((p) => new Types.ObjectId(p)),
    lastMessageAt: over.lastMessageAt,
    lastMessagePreview: over.preview ?? 'hi',
  } as unknown as ConversationDocument;
}

const pagination = (over: Partial<PaginationQuery> = {}): PaginationQuery => ({
  limit: 20,
  ...over,
});

describe('ChatService.listConversations — pagination + batched unread', () => {
  const userId = '507f1f77bcf86cd799439011';

  let service: ChatService;
  let conversationModel: { find: jest.Mock };
  let messageModel: { aggregate: jest.Mock };
  let lastFindFilter: unknown;
  let aggregateMatch: Record<string, unknown> | undefined;

  beforeEach(() => {
    lastFindFilter = undefined;
    aggregateMatch = undefined;

    conversationModel = { find: jest.fn() };
    messageModel = {
      aggregate: jest.fn().mockImplementation((pipeline: Array<Record<string, unknown>>) => {
        aggregateMatch = pipeline[0]?.$match as Record<string, unknown> | undefined;
        return { exec: jest.fn().mockResolvedValue([]) };
      }),
    };

    service = new ChatService(
      conversationModel as unknown as never,
      messageModel as unknown as never,
      { collection: jest.fn() } as unknown as never,
      {} as unknown as FriendsService,
      {} as unknown as BlocksService,
      // listConversations never notifies, so bare stubs suffice here.
      { create: jest.fn() } as unknown as never,
      { isActiveIn: jest.fn(), markActive: jest.fn() } as unknown as never,
    );
  });

  /** Wire `find` to capture the filter and return `docs` from the chain. */
  function primeFind(docs: ConversationDocument[]): void {
    conversationModel.find.mockImplementation((filter: unknown) => {
      lastFindFilter = filter;
      return {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(docs),
      };
    });
  }

  it('returns an empty page for an invalid userId without querying', async () => {
    const page = await service.listConversations('not-an-id', pagination());

    expect(page).toEqual({ items: [], nextCursor: null, hasMore: false });
    expect(conversationModel.find).not.toHaveBeenCalled();
  });

  it('computes unread counts for the WHOLE page in a single aggregation (no N+1)', async () => {
    const docs = [
      conversationDoc({ id: '507f1f77bcf86cd799439101', lastMessageAt: new Date(3000) }),
      conversationDoc({ id: '507f1f77bcf86cd799439102', lastMessageAt: new Date(2000) }),
    ];
    primeFind(docs);
    messageModel.aggregate.mockImplementation((pipeline: Array<Record<string, unknown>>) => {
      aggregateMatch = pipeline[0]?.$match as Record<string, unknown> | undefined;
      return {
        exec: jest.fn().mockResolvedValue([
          { _id: new Types.ObjectId('507f1f77bcf86cd799439101'), count: 4 },
          { _id: new Types.ObjectId('507f1f77bcf86cd799439102'), count: 0 },
        ]),
      };
    });

    const page = await service.listConversations(userId, pagination());

    // Exactly ONE aggregate call covers all conversations on the page.
    expect(messageModel.aggregate).toHaveBeenCalledTimes(1);
    expect(page.items[0]?.unreadCount).toBe(4);
    expect(page.items[1]?.unreadCount).toBe(0);
    // The $match excludes the caller's own messages and unread only.
    expect(aggregateMatch).toMatchObject({ senderId: { $ne: expect.anything() }, readAt: null });
    const inClause = (aggregateMatch?.conversationId as { $in: Types.ObjectId[] }).$in;
    expect(inClause).toHaveLength(2);
  });

  it('signals hasMore and emits a decodable cursor when a full page+1 is returned', async () => {
    // limit 1, but 2 rows returned → hasMore true, page trimmed to 1.
    const docs = [
      conversationDoc({ id: '507f1f77bcf86cd799439101', lastMessageAt: new Date(3000) }),
      conversationDoc({ id: '507f1f77bcf86cd799439102', lastMessageAt: new Date(2000) }),
    ];
    primeFind(docs);

    const page = await service.listConversations(userId, pagination({ limit: 1 }));

    expect(page.hasMore).toBe(true);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();

    // The emitted cursor, fed back in, builds a keyset filter (find sees an $or).
    await service.listConversations(userId, pagination({ limit: 1, cursor: page.nextCursor! }));
    expect(lastFindFilter).toHaveProperty('$or');
  });

  it('has no cursor and hasMore=false on the last (short) page', async () => {
    primeFind([conversationDoc({ id: '507f1f77bcf86cd799439101', lastMessageAt: new Date(3000) })]);

    const page = await service.listConversations(userId, pagination({ limit: 20 }));

    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('returns a terminal empty page for an unparseable cursor', async () => {
    const page = await service.listConversations(userId, pagination({ cursor: '@@not-base64@@' }));

    expect(page).toEqual({ items: [], nextCursor: null, hasMore: false });
    // A bad cursor short-circuits before hitting the DB.
    expect(conversationModel.find).not.toHaveBeenCalled();
  });

  it('pages by _id only once the cursor sits on a null lastMessageAt block', async () => {
    primeFind([
      conversationDoc({ id: '507f1f77bcf86cd799439201', lastMessageAt: null }),
      conversationDoc({ id: '507f1f77bcf86cd799439202', lastMessageAt: null }),
    ]);

    const first = await service.listConversations(userId, pagination({ limit: 1 }));
    expect(first.nextCursor).toBeTruthy();

    await service.listConversations(userId, pagination({ limit: 1, cursor: first.nextCursor! }));

    // A null-timestamp cursor pages purely on _id within the null block.
    expect(lastFindFilter).toMatchObject({ lastMessageAt: null });
    expect((lastFindFilter as { _id: { $lt: unknown } })._id).toHaveProperty('$lt');
  });
});
