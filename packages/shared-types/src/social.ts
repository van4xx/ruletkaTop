import { z } from 'zod';
import { isoDateSchema, objectIdSchema, onlineStatusSchema } from './common';
import { publicProfileSchema } from './profile';

// ──────────────────────────── Friendships ────────────────────────────
export const friendshipStatusSchema = z.enum(['pending', 'accepted', 'blocked']);
export type FriendshipStatus = z.infer<typeof friendshipStatusSchema>;

export const friendRequestSchema = z.object({
  recipientId: objectIdSchema,
});
export type FriendRequestDto = z.infer<typeof friendRequestSchema>;

export const friendshipSchema = z.object({
  id: objectIdSchema,
  requesterId: objectIdSchema,
  recipientId: objectIdSchema,
  status: friendshipStatusSchema,
  createdAt: isoDateSchema,
});
export type Friendship = z.infer<typeof friendshipSchema>;

export const friendSummarySchema = z.object({
  friendshipId: objectIdSchema,
  profile: publicProfileSchema.pick({
    id: true,
    nickname: true,
    avatarUrl: true,
    isPremium: true,
    badges: true,
  }),
  status: onlineStatusSchema,
  since: isoDateSchema,
});
export type FriendSummary = z.infer<typeof friendSummarySchema>;

/** A pending friend request (either direction) for `GET /friends/requests`. */
export const friendRequestItemSchema = z.object({
  friendshipId: objectIdSchema,
  profile: publicProfileSchema.pick({
    id: true,
    nickname: true,
    avatarUrl: true,
    isPremium: true,
    badges: true,
  }),
  /** `incoming` = they asked you; `outgoing` = you asked them (awaiting accept). */
  direction: z.enum(['incoming', 'outgoing']),
  createdAt: isoDateSchema,
});
export type FriendRequestItem = z.infer<typeof friendRequestItemSchema>;

export const friendRequestsResponseSchema = z.object({
  incoming: z.array(friendRequestItemSchema),
  outgoing: z.array(friendRequestItemSchema),
});
export type FriendRequestsResponse = z.infer<typeof friendRequestsResponseSchema>;

// ───────────────────────── Conversations & messages ───────────────────
export const messageTypeSchema = z.enum(['text', 'image', 'gift']);
export type MessageType = z.infer<typeof messageTypeSchema>;

export const messageSchema = z.object({
  id: objectIdSchema,
  conversationId: objectIdSchema,
  senderId: objectIdSchema,
  type: messageTypeSchema,
  content: z.string(),
  readAt: isoDateSchema.nullable(),
  createdAt: isoDateSchema,
});
export type Message = z.infer<typeof messageSchema>;

export const conversationSchema = z.object({
  id: objectIdSchema,
  participants: z.array(objectIdSchema).length(2),
  lastMessageAt: isoDateSchema.nullable(),
  lastMessagePreview: z.string().nullable(),
  unreadCount: z.number().int().nonnegative(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const sendMessageSchema = z
  .object({
    conversationId: objectIdSchema.optional(),
    recipientId: objectIdSchema.optional(),
    type: messageTypeSchema.default('text'),
    content: z.string().min(1).max(4000),
  })
  .refine((v) => Boolean(v.conversationId) || Boolean(v.recipientId), {
    message: 'conversationId or recipientId is required',
  });
export type SendMessageDto = z.infer<typeof sendMessageSchema>;
