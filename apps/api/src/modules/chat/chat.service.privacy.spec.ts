import { Types } from 'mongoose';

import type { BlocksService } from '../moderation/blocks.service';
import type { FriendsService } from '../friends/friends.service';
import { ChatService } from './chat.service';

/**
 * Unit coverage for the two privacy-completion helpers added to ChatService:
 *  - {@link ChatService.classifyRejection} — typed `chat:rejected` reasons; and
 *  - {@link ChatService.getConversationPeerIdentity} — minimal identity for an
 *    existing chat partner whose full profile would be privacy-gated.
 *
 * Both are pure logic over mocked Mongo collections / the block + friends gates,
 * so no database is involved.
 */
describe('ChatService — privacy completions', () => {
  const me = '507f1f77bcf86cd799439011';
  const peer = '507f1f77bcf86cd799439012';

  let service: ChatService;
  let conversationModel: { exists: jest.Mock; findById: jest.Mock };
  let blocks: { isBlocked: jest.Mock };
  let friends: { areFriends: jest.Mock };
  let settingsFindOne: jest.Mock;
  let profilesFindOne: jest.Mock;

  beforeEach(() => {
    conversationModel = { exists: jest.fn(), findById: jest.fn() };
    blocks = { isBlocked: jest.fn().mockResolvedValue(false) };
    friends = { areFriends: jest.fn().mockResolvedValue(false) };

    // `whoCanMessage` defaults to everyone (no settings doc) unless overridden.
    settingsFindOne = jest.fn().mockResolvedValue(null);
    profilesFindOne = jest.fn().mockResolvedValue(null);
    const connection = {
      collection: jest.fn().mockImplementation((name: string) => ({
        findOne: name === 'settings' ? settingsFindOne : profilesFindOne,
      })),
    };

    service = new ChatService(
      conversationModel as unknown as never,
      {} as unknown as never, // messageModel — unused by these methods
      connection as unknown as never,
      friends as unknown as FriendsService,
      blocks as unknown as BlocksService,
      { create: jest.fn() } as unknown as never,
      { isActiveIn: jest.fn(), markActive: jest.fn() } as unknown as never,
    );
  });

  describe('classifyRejection', () => {
    it("returns 'not_found' when neither a valid recipientId nor conversation resolves", async () => {
      const reason = await service.classifyRejection(me, { recipientId: 'nope', content: 'hi' });
      expect(reason).toBe('not_found');
      // Never reached the block/privacy probes.
      expect(blocks.isBlocked).not.toHaveBeenCalled();
    });

    it("returns 'not_found' for a self-send", async () => {
      const reason = await service.classifyRejection(me, { recipientId: me, content: 'hi' });
      expect(reason).toBe('not_found');
    });

    it("returns 'blocked' when a block exists in either direction", async () => {
      blocks.isBlocked.mockResolvedValue(true);
      const reason = await service.classifyRejection(me, { recipientId: peer, content: 'hi' });
      expect(reason).toBe('blocked');
    });

    it("returns 'privacy' when the recipient accepts messages from nobody", async () => {
      settingsFindOne.mockResolvedValue({ privacy: { whoCanMessage: 'nobody' } });
      const reason = await service.classifyRejection(me, { recipientId: peer, content: 'hi' });
      expect(reason).toBe('privacy');
    });

    it("returns 'privacy' for friends-only when the sender is not a friend", async () => {
      settingsFindOne.mockResolvedValue({ privacy: { whoCanMessage: 'friends' } });
      friends.areFriends.mockResolvedValue(false);
      const reason = await service.classifyRejection(me, { recipientId: peer, content: 'hi' });
      expect(reason).toBe('privacy');
    });

    it("returns 'error' when nothing forbids the send (an unexpected failure)", async () => {
      // everyone + not blocked → no classifiable gate matched.
      const reason = await service.classifyRejection(me, { recipientId: peer, content: 'hi' });
      expect(reason).toBe('error');
    });

    it('resolves the recipient from a conversationId WITHOUT creating one', async () => {
      conversationModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          participants: [new Types.ObjectId(me), new Types.ObjectId(peer)],
        }),
      });
      blocks.isBlocked.mockResolvedValue(true);

      const reason = await service.classifyRejection(me, {
        conversationId: '507f1f77bcf86cd799439101',
        content: 'hi',
      });

      expect(reason).toBe('blocked');
      // The read-only resolver must look the conversation up, never upsert it.
      expect(conversationModel.findById).toHaveBeenCalledTimes(1);
    });
  });

  describe('getConversationPeerIdentity', () => {
    it('404s when no conversation is shared with the peer', async () => {
      conversationModel.exists.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(service.getConversationPeerIdentity(me, peer)).rejects.toMatchObject({
        status: 404,
      });
      // Never read the profile — the entitlement check failed first.
      expect(profilesFindOne).not.toHaveBeenCalled();
    });

    it('returns the minimal identity for an existing chat partner', async () => {
      conversationModel.exists.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      });
      profilesFindOne.mockResolvedValue({
        userId: new Types.ObjectId(peer),
        nickname: 'Hidden',
        avatarUrl: 'https://cdn.example/a.png',
      });

      const identity = await service.getConversationPeerIdentity(me, peer);

      expect(identity).toEqual({
        id: peer,
        nickname: 'Hidden',
        avatarUrl: 'https://cdn.example/a.png',
      });
    });

    it('404s when the shared conversation exists but the profile row is gone', async () => {
      conversationModel.exists.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      });
      profilesFindOne.mockResolvedValue(null);

      await expect(service.getConversationPeerIdentity(me, peer)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('404s on an invalid peer id without touching the database', async () => {
      await expect(service.getConversationPeerIdentity(me, 'not-an-id')).rejects.toMatchObject({
        status: 404,
      });
      expect(conversationModel.exists).not.toHaveBeenCalled();
    });
  });
});
