import { z } from 'zod';
import { matchTypeSchema, objectIdSchema, onlineStatusSchema } from './common';
import { matchEndReasonSchema, matchFiltersSchema, peerInfoSchema } from './matchmaking';
import type { Message } from './social';
import type { ModerationActionPayload } from './moderation';

// ─────────────────────────── Event name registry ──────────────────────
export const SocketEvents = {
  // matchmaking
  MM_JOIN: 'mm:join',
  MM_LEAVE: 'mm:leave',
  MM_NEXT: 'mm:next',
  MM_WAITING: 'mm:waiting',
  MM_MATCHED: 'mm:matched',
  // signaling (WebRTC)
  RTC_OFFER: 'rtc:offer',
  RTC_ANSWER: 'rtc:answer',
  RTC_ICE: 'rtc:ice-candidate',
  RTC_HANGUP: 'rtc:hangup',
  // presence
  PRESENCE_ONLINE: 'presence:online',
  PRESENCE_OFFLINE: 'presence:offline',
  PRESENCE_SUBSCRIBE: 'presence:subscribe',
  // chat
  CHAT_MESSAGE: 'chat:message',
  CHAT_TYPING: 'chat:typing',
  CHAT_READ: 'chat:read',
  // direct calls (friends)
  CALL_INVITE: 'call:invite',
  CALL_ACCEPT: 'call:accept',
  CALL_DECLINE: 'call:decline',
  CALL_END: 'call:end',
  // notifications
  NOTIF_NEW: 'notif:new',
  // moderation (server→client forced action: warn/kick/ban)
  MODERATION_ACTION: 'mod:action',
  // errors
  WS_ERROR: 'ws:error',
} as const;

// ──────────────────────────── Payload schemas ─────────────────────────
export const mmJoinPayloadSchema = z.object({
  type: matchTypeSchema,
  filters: matchFiltersSchema,
});
export type MmJoinPayload = z.infer<typeof mmJoinPayloadSchema>;

export const mmMatchedPayloadSchema = z.object({
  roomId: z.string(),
  type: matchTypeSchema,
  peer: peerInfoSchema,
  /** The peer who must create the SDP offer first. */
  isInitiator: z.boolean(),
});
export type MmMatchedPayload = z.infer<typeof mmMatchedPayloadSchema>;

export const mmWaitingPayloadSchema = z.object({
  positionHint: z.number().int().nonnegative().optional(),
});
export type MmWaitingPayload = z.infer<typeof mmWaitingPayloadSchema>;

export const rtcOfferPayloadSchema = z.object({ roomId: z.string(), sdp: z.string() });
export type RtcOfferPayload = z.infer<typeof rtcOfferPayloadSchema>;

export const rtcAnswerPayloadSchema = z.object({ roomId: z.string(), sdp: z.string() });
export type RtcAnswerPayload = z.infer<typeof rtcAnswerPayloadSchema>;

export const rtcIcePayloadSchema = z.object({
  roomId: z.string(),
  /** RTCIceCandidateInit (kept opaque in the contract). */
  candidate: z.unknown(),
});
export type RtcIcePayload = z.infer<typeof rtcIcePayloadSchema>;

export const rtcHangupPayloadSchema = z.object({
  roomId: z.string(),
  reason: matchEndReasonSchema.default('stop'),
});
export type RtcHangupPayload = z.infer<typeof rtcHangupPayloadSchema>;

export const presencePayloadSchema = z.object({
  userId: objectIdSchema,
  status: onlineStatusSchema,
});
export type PresencePayload = z.infer<typeof presencePayloadSchema>;

export const chatTypingPayloadSchema = z.object({
  conversationId: objectIdSchema,
  isTyping: z.boolean(),
});
export type ChatTypingPayload = z.infer<typeof chatTypingPayloadSchema>;

export const chatReadPayloadSchema = z.object({
  conversationId: objectIdSchema,
  messageId: objectIdSchema,
});
export type ChatReadPayload = z.infer<typeof chatReadPayloadSchema>;

export const callInvitePayloadSchema = z.object({
  toUserId: objectIdSchema,
  type: matchTypeSchema,
});
export type CallInvitePayload = z.infer<typeof callInvitePayloadSchema>;

export const callResponsePayloadSchema = z.object({ callId: z.string() });
export type CallResponsePayload = z.infer<typeof callResponsePayloadSchema>;

export const appNotificationSchema = z.object({
  id: z.string(),
  kind: z.enum(['friend_request', 'message', 'gift', 'call', 'system']),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type AppNotification = z.infer<typeof appNotificationSchema>;

/**
 * Server→client error signal for a rejected realtime action (rate limit hit,
 * concurrent-socket cap, forced disconnect, …). `code` is a stable machine
 * token; `event` echoes the offending client event when applicable.
 */
export const wsErrorPayloadSchema = z.object({
  code: z.enum(['rate_limited', 'too_many_connections', 'forbidden', 'banned', 'unauthorized']),
  event: z.string().optional(),
  message: z.string().optional(),
});
export type WsErrorPayload = z.infer<typeof wsErrorPayloadSchema>;

// ───────────────────────── Typed socket.io maps ───────────────────────
// Use as: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
export interface ClientToServerEvents {
  'mm:join': (p: MmJoinPayload) => void;
  'mm:leave': () => void;
  'mm:next': () => void;
  'rtc:offer': (p: RtcOfferPayload) => void;
  'rtc:answer': (p: RtcAnswerPayload) => void;
  'rtc:ice-candidate': (p: RtcIcePayload) => void;
  'rtc:hangup': (p: RtcHangupPayload) => void;
  'presence:subscribe': (userIds: string[]) => void;
  'chat:message': (p: { conversationId?: string; recipientId?: string; content: string }) => void;
  'chat:typing': (p: ChatTypingPayload) => void;
  'chat:read': (p: ChatReadPayload) => void;
  'call:invite': (p: CallInvitePayload) => void;
  'call:accept': (p: CallResponsePayload) => void;
  'call:decline': (p: CallResponsePayload) => void;
  'call:end': (p: CallResponsePayload) => void;
}

export interface ServerToClientEvents {
  'mm:waiting': (p: MmWaitingPayload) => void;
  'mm:matched': (p: MmMatchedPayload) => void;
  'rtc:offer': (p: RtcOfferPayload) => void;
  'rtc:answer': (p: RtcAnswerPayload) => void;
  'rtc:ice-candidate': (p: RtcIcePayload) => void;
  'rtc:hangup': (p: RtcHangupPayload) => void;
  'presence:online': (p: PresencePayload) => void;
  'presence:offline': (p: PresencePayload) => void;
  'chat:message': (m: Message) => void;
  'chat:typing': (p: ChatTypingPayload) => void;
  'chat:read': (p: ChatReadPayload) => void;
  'call:invite': (p: CallInvitePayload & { callId: string; fromUserId: string }) => void;
  'call:accept': (p: CallResponsePayload) => void;
  'call:decline': (p: CallResponsePayload) => void;
  'call:end': (p: CallResponsePayload) => void;
  'notif:new': (n: AppNotification) => void;
  /** A forced moderation action on the current session (warn/kick/ban). */
  'mod:action': (p: ModerationActionPayload) => void;
  /** A realtime action was rejected (rate limit, socket cap, ban, …). */
  'ws:error': (p: WsErrorPayload) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  userId: string;
  role: string;
}
