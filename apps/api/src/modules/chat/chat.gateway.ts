import { Logger, type OnModuleInit } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';

import type {
  ChatReadPayload,
  ChatTypingPayload,
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
  WsErrorPayload,
} from '@ruletka/shared-types';

import type { AppIoServer } from '../../realtime/redis-io.adapter';
import { CHAT_MESSAGE_LIMIT } from '../realtime-security/realtime-security.constants';
import { WsAuthService } from '../realtime-security/ws-auth.service';
import { WsRateLimiterService } from '../realtime-security/ws-rate-limiter.service';
import { ActiveConversationService } from './active-conversation.service';
import { ChatService } from './chat.service';

/** Socket typed with the shared client→server map + per-connection data. */
type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

/** Inbound `chat:message` shape (matches the shared ClientToServerEvents map). */
interface ChatMessageInput {
  conversationId?: string;
  recipientId?: string;
  content: string;
}

/** Per-user room name (every device the user connects with joins it). */
function userRoom(userId: string): string {
  return `user:${userId}`;
}

/**
 * Realtime direct-messaging gateway (`/chat` namespace).
 *
 * Authentication: the client passes its access token in `handshake.auth.token`;
 * {@link WsAuthService} verifies it (HS256-pinned + Zod-validated), the account
 * is re-checked for an active ban, and the per-user concurrent-socket cap is
 * enforced before `{ userId, role }` is stashed on `socket.data`. Rejected
 * sockets receive a `ws:error` and are disconnected. Each socket joins a
 * per-user room so messages can be delivered to all of a user's devices and
 * across API instances (via the Redis adapter configured in
 * {@link RedisIoAdapter}). A cluster-wide `user:disconnect` subscription drops a
 * user's sockets the moment moderation bans them.
 *
 * Events (all per-user rate-limited):
 * - `chat:message` — persist via {@link ChatService} and emit the stored
 *   {@link Message} to BOTH participants' rooms (sender echo + recipient).
 * - `chat:typing` — relay the typing indicator to the other participant.
 * - `chat:read` — persist read receipts and relay to the other participant.
 */
@WebSocketGateway({ namespace: '/chat' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer() server!: AppIoServer;

  constructor(
    private readonly chatService: ChatService,
    private readonly wsAuth: WsAuthService,
    private readonly rateLimiter: WsRateLimiterService,
    private readonly activeConversations: ActiveConversationService,
  ) {}

  /**
   * Subscribe to the cluster-wide ban channel: when moderation bans a user,
   * force-disconnect any of that user's chat sockets connected to THIS node.
   */
  onModuleInit(): void {
    this.wsAuth.onDisconnectRequest((userId) => {
      void this.disconnectUser(userId);
    });
  }

  /**
   * Verify the handshake token (HS256-pinned + shape-validated), reject banned
   * accounts, enforce the per-user concurrent-socket cap, then bind identity to
   * the socket and join its room.
   */
  async handleConnection(client: ChatSocket): Promise<void> {
    const token = extractToken(client);
    const payload = this.wsAuth.verifyToken(token);
    if (!payload) {
      emitWsError(client, { code: 'unauthorized', message: 'Invalid token' });
      client.disconnect(true);
      return;
    }
    if (await this.wsAuth.isBanned(payload.sub)) {
      emitWsError(client, { code: 'banned', message: 'Account is banned' });
      client.disconnect(true);
      return;
    }
    if (!(await this.rateLimiter.registerSocket(payload.sub))) {
      emitWsError(client, {
        code: 'too_many_connections',
        message: 'Too many active connections',
      });
      client.disconnect(true);
      return;
    }
    client.data.userId = payload.sub;
    client.data.role = payload.role;
    void client.join(userRoom(payload.sub));
    this.logger.debug(`chat socket connected: user=${payload.sub}`);
  }

  async handleDisconnect(client: ChatSocket): Promise<void> {
    const userId = client.data.userId;
    if (!userId) {
      return;
    }
    this.logger.debug(`chat socket disconnected: user=${userId}`);
    await this.rateLimiter.releaseSocket(userId).catch((err: unknown) => {
      this.logger.debug(`releaseSocket failed for ${userId}: ${asMessage(err)}`);
    });
  }

  /**
   * Force-disconnect every local chat socket belonging to `userId` (invoked
   * from the cluster-wide ban channel). The Socket.io adapter scopes
   * `disconnectSockets` to this node's sockets in the per-user room.
   */
  private async disconnectUser(userId: string): Promise<void> {
    try {
      const room = this.server.to(userRoom(userId));
      room.emit('ws:error', { code: 'banned', message: 'Account is banned' });
      room.disconnectSockets(true);
      this.logger.debug(`force-disconnected chat sockets for banned user=${userId}`);
    } catch (err) {
      this.logger.debug(`disconnectUser failed for ${userId}: ${asMessage(err)}`);
    }
  }

  /**
   * Persist an inbound message and fan it out. Emits the stored message to the
   * recipient's room AND back to the sender's room (so the sender's other
   * devices stay in sync and the originating client gets the canonical row).
   */
  @SubscribeMessage('chat:message')
  async handleMessage(client: ChatSocket, payload: ChatMessageInput): Promise<void> {
    const senderId = client.data.userId;
    if (!senderId || !payload || typeof payload.content !== 'string') {
      return;
    }
    if (!(await this.rateLimiter.consume(senderId, CHAT_MESSAGE_LIMIT))) {
      emitWsError(client, { code: 'rate_limited', event: 'chat:message' });
      return;
    }
    const content = payload.content.trim();
    if (content.length === 0 || content.length > 4000) {
      return;
    }

    try {
      const sent = await this.chatService.sendMessage(senderId, {
        conversationId: payload.conversationId,
        recipientId: payload.recipientId,
        content,
      });
      // Sending into a thread proves the sender is focused on it — refresh their
      // focus marker so an immediate reply back doesn't notify THEM.
      void this.activeConversations.markActive(senderId, sent.conversationId);
      // Deliver to recipient and echo to sender (canonical stored shape).
      this.server.to(userRoom(sent.recipientId)).emit('chat:message', sent.message);
      this.server.to(userRoom(senderId)).emit('chat:message', sent.message);
    } catch (err) {
      // Gate failures (block/privacy) and validation errors are swallowed for
      // the realtime path — the client won't receive an echo, signalling drop.
      this.logger.debug(`chat:message rejected for ${senderId}: ${asMessage(err)}`);
    }
  }

  /** Relay a typing indicator to the conversation's other participant. */
  @SubscribeMessage('chat:typing')
  async handleTyping(client: ChatSocket, payload: ChatTypingPayload): Promise<void> {
    const userId = client.data.userId;
    if (!userId || !payload?.conversationId) {
      return;
    }
    // Typing in a thread means the user is looking at it — refresh focus.
    void this.activeConversations.markActive(userId, payload.conversationId);
    try {
      const recipientId = await this.chatService.getOtherParticipant(
        payload.conversationId,
        userId,
      );
      this.server.to(userRoom(recipientId)).emit('chat:typing', {
        conversationId: payload.conversationId,
        isTyping: Boolean(payload.isTyping),
      });
    } catch (err) {
      this.logger.debug(`chat:typing dropped for ${userId}: ${asMessage(err)}`);
    }
  }

  /** Persist read receipts up to `messageId` and relay to the other participant. */
  @SubscribeMessage('chat:read')
  async handleRead(client: ChatSocket, payload: ChatReadPayload): Promise<void> {
    const userId = client.data.userId;
    if (!userId || !payload?.conversationId || !payload?.messageId) {
      return;
    }
    // Reading a thread (open / scroll) marks the user as focused on it, so an
    // inbound message while they're here won't raise a redundant notification.
    void this.activeConversations.markActive(userId, payload.conversationId);
    try {
      const { recipientId } = await this.chatService.markRead(
        payload.conversationId,
        userId,
        payload.messageId,
      );
      this.server.to(userRoom(recipientId)).emit('chat:read', {
        conversationId: payload.conversationId,
        messageId: payload.messageId,
      });
    } catch (err) {
      this.logger.debug(`chat:read dropped for ${userId}: ${asMessage(err)}`);
    }
  }

}

/**
 * Extract the raw handshake token. Accepts `auth.token` (the documented
 * channel) or an `Authorization: Bearer` header as a fallback. Verification +
 * shape-validation is delegated to {@link WsAuthService}.
 */
function extractToken(client: ChatSocket): string | null {
  const rawAuthToken = (client.handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof rawAuthToken === 'string' && rawAuthToken.length > 0) {
    return rawAuthToken;
  }
  const header = client.handshake.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/** Emit a typed `ws:error` to a single socket. */
function emitWsError(client: ChatSocket, payload: WsErrorPayload): void {
  client.emit('ws:error', payload);
}

/** Narrows an unknown thrown value to a printable message. */
function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
