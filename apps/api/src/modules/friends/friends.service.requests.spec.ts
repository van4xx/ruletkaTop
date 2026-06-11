import { Types } from 'mongoose';

import type { NotificationsService } from '../notifications/notifications.service';
import type { PresenceService } from '../presence/presence.service';
import { FriendsService } from './friends.service';
import type { FriendshipDocument } from './schemas/friendship.schema';

/** Build a stand-in PENDING friendship document keyed (createdAt, _id). */
function pendingDoc(over: {
  id: string;
  requesterId: string;
  recipientId: string;
  createdAt: Date;
}): FriendshipDocument {
  return {
    _id: new Types.ObjectId(over.id),
    requesterId: new Types.ObjectId(over.requesterId),
    recipientId: new Types.ObjectId(over.recipientId),
    status: 'pending',
    get: (key: string) => (key === 'createdAt' ? over.createdAt : undefined),
  } as unknown as FriendshipDocument;
}

describe('FriendsService.listRequests — incoming vs outgoing split', () => {
  const userId = '507f1f77bcf86cd799439011';
  // Someone who sent ME a request (incoming).
  const inboundFrom = '507f1f77bcf86cd7994390b1';
  // Someone I sent a request to (outgoing).
  const outboundTo = '507f1f77bcf86cd7994390b2';

  let service: FriendsService;
  let friendshipModel: { find: jest.Mock };
  let presence: { getStatuses: jest.Mock };
  let profilesFind: jest.Mock;
  let connection: { collection: jest.Mock };
  let lastFindFilter: Record<string, unknown> | undefined;
  let profilesInClause: Types.ObjectId[] | undefined;

  beforeEach(() => {
    lastFindFilter = undefined;
    profilesInClause = undefined;

    friendshipModel = { find: jest.fn() };
    presence = { getStatuses: jest.fn().mockResolvedValue({}) };

    // Batched `profiles` read: capture the $in and return both counterparts.
    profilesFind = jest.fn().mockImplementation((filter: { userId: { $in: Types.ObjectId[] } }) => {
      profilesInClause = filter.userId.$in;
      return {
        toArray: jest.fn().mockResolvedValue([
          {
            userId: new Types.ObjectId(inboundFrom),
            nickname: 'Inbound',
            avatarUrl: null,
            isPremium: false,
            badges: [],
          },
          {
            userId: new Types.ObjectId(outboundTo),
            nickname: 'Outbound',
            avatarUrl: 'https://x/y.png',
            isPremium: true,
            badges: ['premium'],
          },
        ]),
      };
    });
    connection = { collection: jest.fn().mockReturnValue({ find: profilesFind }) };

    const notifications = { create: jest.fn().mockResolvedValue(null) };

    // listRequests does not gate on tier; a `none` stub keeps things simple.
    const premium = {
      getEffectiveTier: jest.fn().mockResolvedValue('none'),
      hasTierOrAbove: jest.fn().mockResolvedValue(false),
    };

    service = new FriendsService(
      friendshipModel as unknown as never,
      connection as unknown as never,
      presence as unknown as PresenceService,
      notifications as unknown as NotificationsService,
      premium as unknown as never,
    );
  });

  function primeFind(docs: FriendshipDocument[]): void {
    friendshipModel.find.mockImplementation((filter: Record<string, unknown>) => {
      lastFindFilter = filter;
      return {
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(docs),
      };
    });
  }

  it('returns empty lists for an invalid userId without querying', async () => {
    const res = await service.listRequests('nope');

    expect(res).toEqual({ incoming: [], outgoing: [] });
    expect(friendshipModel.find).not.toHaveBeenCalled();
  });

  it('queries only PENDING friendships where the caller participates', async () => {
    primeFind([]);

    await service.listRequests(userId);

    expect(lastFindFilter?.status).toBe('pending');
    // Participant predicate: requester OR recipient is the caller.
    const or = lastFindFilter?.$or as Array<Record<string, Types.ObjectId>>;
    expect(or).toHaveLength(2);
    expect(or[0]?.requesterId?.toString()).toBe(userId);
    expect(or[1]?.recipientId?.toString()).toBe(userId);
  });

  it('splits requests by direction and resolves the OTHER user in one $in read', async () => {
    primeFind([
      // They → me  ⇒ incoming (I am the recipient).
      pendingDoc({
        id: '507f1f77bcf86cd799439301',
        requesterId: inboundFrom,
        recipientId: userId,
        createdAt: new Date(3000),
      }),
      // Me → them  ⇒ outgoing (I am the requester).
      pendingDoc({
        id: '507f1f77bcf86cd799439302',
        requesterId: userId,
        recipientId: outboundTo,
        createdAt: new Date(2000),
      }),
    ]);

    const res = await service.listRequests(userId);

    // ONE batched profiles read for BOTH counterparts (no per-request N+1).
    expect(profilesFind).toHaveBeenCalledTimes(1);
    expect(profilesInClause).toHaveLength(2);

    expect(res.incoming).toHaveLength(1);
    expect(res.outgoing).toHaveLength(1);

    const incoming = res.incoming[0]!;
    expect(incoming.direction).toBe('incoming');
    expect(incoming.friendshipId).toBe('507f1f77bcf86cd799439301');
    // The OTHER user (the requester), not the caller.
    expect(incoming.profile.id).toBe(inboundFrom);
    expect(incoming.profile.nickname).toBe('Inbound');
    expect(incoming.createdAt).toBe(new Date(3000).toISOString());

    const outgoing = res.outgoing[0]!;
    expect(outgoing.direction).toBe('outgoing');
    expect(outgoing.friendshipId).toBe('507f1f77bcf86cd799439302');
    // The OTHER user (the recipient), not the caller.
    expect(outgoing.profile.id).toBe(outboundTo);
    expect(outgoing.profile.isPremium).toBe(true);
  });

  it('sorts newest-first (createdAt DESC, _id DESC)', async () => {
    primeFind([]);

    await service.listRequests(userId);

    const sortChain = friendshipModel.find.mock.results[0]!.value as {
      sort: jest.Mock;
    };
    expect(sortChain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
  });

  it('skips a request whose counterpart profile no longer resolves', async () => {
    primeFind([
      pendingDoc({
        id: '507f1f77bcf86cd799439301',
        requesterId: inboundFrom,
        recipientId: userId,
        createdAt: new Date(3000),
      }),
    ]);
    // Profiles read returns nothing → the request is skipped, not crashed on.
    profilesFind.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });

    const res = await service.listRequests(userId);

    expect(res).toEqual({ incoming: [], outgoing: [] });
  });
});
