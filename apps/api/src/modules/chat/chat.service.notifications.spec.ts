import { Types } from 'mongoose';

import type { BlocksService } from '../moderation/blocks.service';
import type { FriendsService } from '../friends/friends.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { ActiveConversationService } from './active-conversation.service';
import { ChatService } from './chat.service';
import type { ConversationDocument } from './schemas/conversation.schema';

const SENDER = '507f1f77bcf86cd799439011';
const RECIPIENT = '507f1f77bcf86cd799439012';
const CONVO_ID = '507f1f77bcf86cd7994390cc';

/** Conversation with both participants (sender + recipient). */
function conversationDoc(): ConversationDocument {
  return {
    _id: new Types.ObjectId(CONVO_ID),
    participants: [new Types.ObjectId(SENDER), new Types.ObjectId(RECIPIENT)],
    lastMessageAt: null,
    lastMessagePreview: '',
  } as unknown as ConversationDocument;
}

/** Persisted-message stand-in exposing `get('createdAt')` + `_id.toString()`. */
function messageDoc(content: string): unknown {
  return {
    _id: { toString: () => 'msg-1' },
    conversationId: { toString: () => CONVO_ID },
    senderId: { toString: () => SENDER },
    type: 'text',
    content,
    readAt: null,
    get: (key: string) => (key === 'createdAt' ? new Date('2026-01-01T00:00:00.000Z') : undefined),
  };
}

describe('ChatService.sendMessage — context (away) notifications', () => {
  let service: ChatService;
  let conversationModel: { findById: jest.Mock; updateOne: jest.Mock };
  let messageModel: { create: jest.Mock };
  let blocks: { isBlocked: jest.Mock };
  let notifications: { create: jest.Mock };
  let activeConversations: { isActiveIn: jest.Mock; markActive: jest.Mock };

  beforeEach(() => {
    conversationModel = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(conversationDoc()),
      }),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    messageModel = { create: jest.fn().mockResolvedValue(messageDoc('hi there')) };

    // `connection.collection(name).findOne(...)`:
    //  - 'settings' → whoCanMessage everyone (gate passes without a friends check)
    //  - 'profiles' → sender nickname for the notification title
    const connection = {
      collection: jest.fn().mockImplementation((name: string) => ({
        findOne: jest
          .fn()
          .mockResolvedValue(
            name === 'settings'
              ? { privacy: { whoCanMessage: 'everyone' } }
              : { nickname: 'Alice' },
          ),
      })),
    };

    blocks = { isBlocked: jest.fn().mockResolvedValue(false) };
    notifications = { create: jest.fn().mockResolvedValue(null) };
    activeConversations = {
      isActiveIn: jest.fn().mockResolvedValue(false),
      markActive: jest.fn().mockResolvedValue(undefined),
    };

    service = new ChatService(
      conversationModel as unknown as never,
      messageModel as unknown as never,
      connection as unknown as never,
      {} as unknown as FriendsService,
      blocks as unknown as BlocksService,
      notifications as unknown as NotificationsService,
      activeConversations as unknown as ActiveConversationService,
    );
  });

  it('raises a `message` notification when the recipient is NOT in the conversation', async () => {
    activeConversations.isActiveIn.mockResolvedValue(false);

    const sent = await service.sendMessage(SENDER, {
      conversationId: CONVO_ID,
      content: 'hi there',
    });

    // Focus was checked for the RECIPIENT against THIS conversation.
    expect(activeConversations.isActiveIn).toHaveBeenCalledWith(RECIPIENT, CONVO_ID);

    expect(notifications.create).toHaveBeenCalledTimes(1);
    const arg = notifications.create.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.recipientUserId).toBe(RECIPIENT);
    expect(arg.kind).toBe('message');
    expect(arg.actorId).toBe(SENDER);
    // Deep-links to the conversation; title is the sender's nickname, body the preview.
    expect(arg.link).toBe(`/chat/${CONVO_ID}`);
    expect(arg.title).toBe('Alice');
    expect(arg.body).toBe('hi there');

    // The message is still delivered/returned normally.
    expect(sent.recipientId).toBe(RECIPIENT);
    expect(sent.conversationId).toBe(CONVO_ID);
  });

  it('does NOT notify when the recipient is actively in that conversation', async () => {
    activeConversations.isActiveIn.mockResolvedValue(true);

    await service.sendMessage(SENDER, { conversationId: CONVO_ID, content: 'hi there' });

    expect(activeConversations.isActiveIn).toHaveBeenCalledWith(RECIPIENT, CONVO_ID);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('never fails the send when the notification path throws (best-effort)', async () => {
    activeConversations.isActiveIn.mockRejectedValue(new Error('redis down'));

    const sent = await service.sendMessage(SENDER, {
      conversationId: CONVO_ID,
      content: 'hi there',
    });

    // The message persisted + returned despite the notification failure.
    expect(messageModel.create).toHaveBeenCalledTimes(1);
    expect(sent.message.id).toBe('msg-1');
    expect(sent.recipientId).toBe(RECIPIENT);
  });
});
