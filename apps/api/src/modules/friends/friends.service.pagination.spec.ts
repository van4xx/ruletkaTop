import { Types } from 'mongoose';

import type { PaginationQuery } from '@ruletka/shared-types';

import type { NotificationsService } from '../notifications/notifications.service';
import type { PresenceService } from '../presence/presence.service';
import { FriendsService } from './friends.service';
import type { FriendshipDocument } from './schemas/friendship.schema';

/** Build a stand-in accepted-friendship document keyed (createdAt, _id). */
function friendshipDoc(over: {
  id: string;
  requesterId: string;
  recipientId: string;
  createdAt: Date;
}): FriendshipDocument {
  return {
    _id: new Types.ObjectId(over.id),
    requesterId: new Types.ObjectId(over.requesterId),
    recipientId: new Types.ObjectId(over.recipientId),
    status: 'accepted',
    get: (key: string) => (key === 'createdAt' ? over.createdAt : undefined),
  } as unknown as FriendshipDocument;
}

const pagination = (over: Partial<PaginationQuery> = {}): PaginationQuery => ({
  limit: 20,
  ...over,
});

describe('FriendsService.listFriends — pagination + batched profiles', () => {
  const userId = '507f1f77bcf86cd799439011';
  const friendA = '507f1f77bcf86cd7994390a1';
  const friendB = '507f1f77bcf86cd7994390a2';

  let service: FriendsService;
  let friendshipModel: { find: jest.Mock };
  let presence: { getStatuses: jest.Mock };
  let profilesFind: jest.Mock;
  let connection: { collection: jest.Mock };
  let lastFindFilter: unknown;
  let profilesInClause: Types.ObjectId[] | undefined;

  beforeEach(() => {
    lastFindFilter = undefined;
    profilesInClause = undefined;

    friendshipModel = { find: jest.fn() };
    presence = { getStatuses: jest.fn().mockResolvedValue({}) };

    // Batched `profiles` read: capture the $in and return both friends' rows.
    profilesFind = jest.fn().mockImplementation((filter: { userId: { $in: Types.ObjectId[] } }) => {
      profilesInClause = filter.userId.$in;
      return {
        toArray: jest.fn().mockResolvedValue([
          {
            userId: new Types.ObjectId(friendA),
            nickname: 'A',
            avatarUrl: null,
            isPremium: false,
            badges: [],
          },
          {
            userId: new Types.ObjectId(friendB),
            nickname: 'B',
            avatarUrl: null,
            isPremium: true,
            badges: ['premium'],
          },
        ]),
      };
    });
    connection = { collection: jest.fn().mockReturnValue({ find: profilesFind }) };

    // listFriends never raises a notification, so a bare stub suffices.
    const notifications = { create: jest.fn().mockResolvedValue(null) };

    service = new FriendsService(
      friendshipModel as unknown as never,
      connection as unknown as never,
      presence as unknown as PresenceService,
      notifications as unknown as NotificationsService,
    );
  });

  function primeFind(docs: FriendshipDocument[]): void {
    friendshipModel.find.mockImplementation((filter: unknown) => {
      lastFindFilter = filter;
      return {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(docs),
      };
    });
  }

  it('returns an empty page for an invalid userId without querying', async () => {
    const page = await service.listFriends('nope', pagination());

    expect(page).toEqual({ items: [], nextCursor: null, hasMore: false });
    expect(friendshipModel.find).not.toHaveBeenCalled();
  });

  it("loads ALL friends' profiles in a single $in query (no per-friend N+1)", async () => {
    primeFind([
      friendshipDoc({
        id: '507f1f77bcf86cd799439301',
        requesterId: userId,
        recipientId: friendA,
        createdAt: new Date(3000),
      }),
      friendshipDoc({
        id: '507f1f77bcf86cd799439302',
        requesterId: friendB,
        recipientId: userId,
        createdAt: new Date(2000),
      }),
    ]);

    const page = await service.listFriends(userId, pagination());

    // ONE profiles read and ONE presence read for the whole page.
    expect(profilesFind).toHaveBeenCalledTimes(1);
    expect(presence.getStatuses).toHaveBeenCalledTimes(1);
    expect(profilesInClause).toHaveLength(2);

    // Resolves the OTHER participant in each direction.
    expect(page.items.map((f) => f.profile.id).sort()).toEqual([friendA, friendB].sort());
    expect(page.items.find((f) => f.profile.id === friendB)?.profile.isPremium).toBe(true);
  });

  it('defaults presence to offline when a friend has no live status', async () => {
    primeFind([
      friendshipDoc({
        id: '507f1f77bcf86cd799439301',
        requesterId: userId,
        recipientId: friendA,
        createdAt: new Date(3000),
      }),
    ]);
    presence.getStatuses.mockResolvedValue({}); // no status for friendA

    const page = await service.listFriends(userId, pagination());

    expect(page.items[0]?.status).toBe('offline');
  });

  it('skips a friend whose profile no longer resolves', async () => {
    primeFind([
      friendshipDoc({
        id: '507f1f77bcf86cd799439301',
        requesterId: userId,
        recipientId: friendA,
        createdAt: new Date(3000),
      }),
    ]);
    // profiles read returns nothing → friend is skipped, not crashed on.
    profilesFind.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });

    const page = await service.listFriends(userId, pagination());

    expect(page.items).toHaveLength(0);
  });

  it('signals hasMore and emits a keyset cursor when a full page+1 is returned', async () => {
    primeFind([
      friendshipDoc({
        id: '507f1f77bcf86cd799439301',
        requesterId: userId,
        recipientId: friendA,
        createdAt: new Date(3000),
      }),
      friendshipDoc({
        id: '507f1f77bcf86cd799439302',
        requesterId: friendB,
        recipientId: userId,
        createdAt: new Date(2000),
      }),
    ]);

    const page = await service.listFriends(userId, pagination({ limit: 1 }));

    expect(page.hasMore).toBe(true);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();

    // Feeding the cursor back ANDs a keyset predicate into the participant query.
    await service.listFriends(userId, pagination({ limit: 1, cursor: page.nextCursor! }));
    const andClauses = (lastFindFilter as { $and: Array<Record<string, unknown>> }).$and;
    // One $and clause is the participant $or; another is the keyset $or whose
    // first branch keys on createdAt.
    const keysetClause = andClauses.find(
      (c): c is { $or: Array<Record<string, unknown>> } =>
        Array.isArray((c as { $or?: unknown }).$or) &&
        ((c as { $or: Array<Record<string, unknown>> }).$or[0]
          ? 'createdAt' in (c as { $or: Array<Record<string, unknown>> }).$or[0]!
          : false),
    );
    expect(keysetClause).toBeDefined();
  });

  it('returns a terminal empty page for an unparseable cursor', async () => {
    const page = await service.listFriends(userId, pagination({ cursor: '@@bad@@' }));

    expect(page).toEqual({ items: [], nextCursor: null, hasMore: false });
    expect(friendshipModel.find).not.toHaveBeenCalled();
  });
});
