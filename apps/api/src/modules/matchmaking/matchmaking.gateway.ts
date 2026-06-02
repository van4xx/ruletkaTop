import { Inject, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Redis } from 'ioredis';
import type { Socket } from 'socket.io';

import {
  type AppNotification,
  appNotificationSchema,
  type ClientToServerEvents,
  type MatchEndReason,
  type MmJoinPayload,
  mmJoinPayloadSchema,
  type ModerationActionPayload,
  moderationActionPayloadSchema,
  type RtcAnswerPayload,
  rtcAnswerPayloadSchema,
  type RtcHangupPayload,
  rtcHangupPayloadSchema,
  type RtcIcePayload,
  rtcIcePayloadSchema,
  type RtcOfferPayload,
  rtcOfferPayloadSchema,
  type ServerToClientEvents,
  type SocketData,
  type WsErrorPayload,
} from '@ruletka/shared-types';

import { MetricsService } from '../../observability/metrics.service';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import type { AppIoServer } from '../../realtime/redis-io.adapter';
import { MM_JOIN_LIMIT, RTC_SIGNAL_LIMIT } from '../realtime-security/realtime-security.constants';
import { WsAuthService } from '../realtime-security/ws-auth.service';

/**
 * Cross-instance channel on which the moderation module publishes a forced
 * mid-call action for an offending user. MUST stay identical to
 * `MODERATION_ACTION_CHANNEL` in `modules/moderation/moderation.constants.ts`
 * (the string is duplicated rather than imported, mirroring how the
 * `user:disconnect` channel name is declared on both sides, to keep the gateway
 * free of a value-import dependency on the moderation module).
 *
 * Wire contract: JSON `{ userId: string, payload: ModerationActionPayload }`.
 */
const MODERATION_ACTION_CHANNEL = 'moderation:action';

/**
 * Cross-instance channel on which the notifications module publishes a newly
 * created notification for a recipient. MUST stay identical to
 * `NOTIFICATION_NEW_CHANNEL` in
 * `modules/notifications/notifications.constants.ts` (the string is duplicated
 * rather than imported, mirroring how the `moderation:action` and
 * `user:disconnect` channel names are declared on both sides, to keep the
 * gateway free of a value-import dependency on the notifications module).
 *
 * Wire contract: JSON `{ userId: string, notification: AppNotification }`. The
 * gateway emits `notif:new` to `mm:user:<userId>`.
 */
const NOTIFICATION_NEW_CHANNEL = 'notif:new';
import { WsRateLimiterService } from '../realtime-security/ws-rate-limiter.service';
import {
  type ConnectionVerifier,
  type MatchResult,
  MatchmakingService,
} from './matchmaking.service';
import type { WaiterEntry } from './matchmaking.types';

/** Socket typed with the shared client→server map + per-connection data. */
type MmSocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

/**
 * Per-user room every device joins on connect. Signaling / teardown emit here
 * so a user is reachable on whichever API node holds their socket (delivery is
 * fanned out cluster-wide by the Socket.io Redis adapter).
 */
function userRoom(userId: string): string {
  return `mm:user:${userId}`;
}

/**
 * Matchmaking + WebRTC signaling gateway (`/mm` namespace) — the core of the
 * roulette.
 *
 * Authentication: the client passes its access token in `handshake.auth.token`
 * (or an `Authorization: Bearer` header); {@link WsAuthService} verifies it
 * (HS256-pinned + Zod-validated), the account is re-checked for an active ban,
 * and the per-user concurrent-socket cap is enforced before `{ userId, role }`
 * is stashed on `socket.data`. Each socket joins its per-user room. A
 * cluster-wide `user:disconnect` subscription drops a user's sockets the moment
 * moderation bans them.
 *
 * Matchmaking ({@link MatchmakingService}, Redis-backed):
 * - `mm:join` — rate-limited; enqueue and search for a MUTUALLY-compatible,
 *   non-blocked, `whoCanCall`-permitted, connected peer (premium prioritised).
 *   On a match each side receives `mm:matched` (delivered to its per-user room)
 *   with the OTHER's `PeerInfo` and an `isInitiator` flag (exactly one side
 *   true). Otherwise `mm:waiting`.
 * - `mm:next` — rate-limited; tears down the current room (peer gets
 *   `rtc:hangup` reason `next`) and re-queues with the same filters.
 * - `mm:leave` / disconnect — dequeue, end any active match, notify the peer.
 *
 * Signaling (server only relays SDP/ICE; media is P2P): `rtc:offer`,
 * `rtc:answer`, `rtc:ice-candidate`, `rtc:hangup` are validated, gated on room
 * membership and forwarded to the peer's user room only; the offer/answer/ice
 * relays are additionally per-user rate-limited to cap signaling floods.
 */
@WebSocketGateway({ namespace: '/mm' })
export class MatchmakingGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MatchmakingGateway.name);

  @WebSocketServer() server!: AppIoServer;

  /** Dedicated SUBSCRIBE connection for the moderation-action channel. */
  private modActionSub?: Redis;

  /** Dedicated SUBSCRIBE connection for the notification-delivery channel. */
  private notifSub?: Redis;

  constructor(
    private readonly matchmaking: MatchmakingService,
    private readonly wsAuth: WsAuthService,
    private readonly rateLimiter: WsRateLimiterService,
    private readonly metrics: MetricsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Subscribe to the cluster-wide ban channel: when moderation bans a user,
   * force-disconnect any of that user's sockets connected to THIS node. Also
   * subscribe to the moderation-action channel so a forced warn/kick/ban is
   * delivered (`mod:action`) and the offender's active call is ended here.
   */
  onModuleInit(): void {
    this.wsAuth.onDisconnectRequest((userId) => {
      void this.disconnectUser(userId);
    });
    void this.subscribeModerationActions();
    void this.subscribeNotifications();
  }

  /** Close the dedicated moderation-action + notification subscribers on shutdown. */
  async onModuleDestroy(): Promise<void> {
    for (const sub of [this.modActionSub, this.notifSub]) {
      if (!sub) {
        continue;
      }
      try {
        await sub.quit();
      } catch (err) {
        this.logger.debug(`closing realtime subscriber failed: ${asMessage(err)}`);
      }
    }
  }

  /** Cluster-wide check that a socket id still has a live connection. */
  private get isConnected(): ConnectionVerifier {
    return async (socketId: string): Promise<boolean> => {
      const sockets = await this.server.in(socketId).fetchSockets();
      return sockets.length > 0;
    };
  }

  // ── Connection lifecycle ─────────────────────────────────────────────────────

  /**
   * Verify the handshake token (HS256-pinned + shape-validated), reject banned
   * accounts, enforce the per-user concurrent-socket cap, then bind identity and
   * join the per-user room.
   */
  async handleConnection(client: MmSocket): Promise<void> {
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
    // Count only fully-established sockets (past auth/ban/cap). The matching
    // decrement is in `handleDisconnect`, also gated on `userId` being set, so
    // rejected handshakes never skew the gauge.
    this.metrics.socketConnected();
    this.logger.debug(`mm socket connected: user=${payload.sub} socket=${client.id}`);
  }

  /**
   * On disconnect, release the user's socket slot, remove them from every pool
   * and tear down any active room, notifying the peer. We swallow errors so one
   * failing cleanup never blocks the others.
   */
  async handleDisconnect(client: MmSocket): Promise<void> {
    const userId = client.data.userId;
    if (!userId) {
      return;
    }
    // Mirror the connect-time increment (this path runs only for sockets that
    // bound identity), keeping the active-sockets gauge balanced.
    this.metrics.socketDisconnected();
    this.logger.debug(`mm socket disconnected: user=${userId}`);
    try {
      await this.rateLimiter.releaseSocket(userId);
      await this.matchmaking.dequeueAll(userId);
      await this.endActiveRoom(userId, 'disconnect');
    } catch (err) {
      this.logger.debug(`disconnect cleanup failed for ${userId}: ${asMessage(err)}`);
    }
  }

  // ── Matchmaking ────────────────────────────────────────────────────────────

  /**
   * Join the pool for a modality and attempt an immediate match. Emits
   * `mm:matched` to both sides on success, or `mm:waiting` to the joiner.
   */
  @SubscribeMessage('mm:join')
  async handleJoin(client: MmSocket, payload: MmJoinPayload): Promise<void> {
    const userId = client.data.userId;
    if (!userId) {
      return;
    }
    if (!(await this.rateLimiter.consume(userId, MM_JOIN_LIMIT))) {
      emitWsError(client, { code: 'rate_limited', event: 'mm:join' });
      return;
    }
    const parsed = mmJoinPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.debug(`mm:join rejected for ${userId}: invalid payload`);
      return;
    }

    // Re-joining while already in a call: end the old room first (treated as a
    // voluntary stop) so we never leak a room.
    await this.endActiveRoom(userId, 'stop');

    await this.joinAndMatch(userId, client.id, parsed.data);
  }

  /**
   * Skip the current peer and find a new one. Rate-limited per user. Tears down
   * the current room (peer notified with `rtc:hangup` reason `next`) and
   * re-queues with the user's existing filters/type, then attempts a match.
   */
  @SubscribeMessage('mm:next')
  async handleNext(client: MmSocket): Promise<void> {
    const userId = client.data.userId;
    if (!userId) {
      return;
    }
    const allowed = await this.matchmaking.consumeNextToken(userId);
    if (!allowed) {
      this.logger.debug(`mm:next rate-limited for ${userId}`);
      return;
    }

    // Remember the user's filters/type from their current room BEFORE teardown.
    const pointer = await this.matchmaking.getUserRoom(userId);
    const teardown = await this.matchmaking.teardownRoom(userId, 'next');
    if (teardown) {
      this.notifyPeerHangup(teardown.peerUserId, teardown.roomId, 'next');
    }

    if (!pointer) {
      // No active room to "next" from — nothing to re-queue with.
      return;
    }
    await this.joinAndMatch(userId, client.id, { type: pointer.type, filters: pointer.filters });
  }

  /** Leave matchmaking entirely: dequeue and end any active room. */
  @SubscribeMessage('mm:leave')
  async handleLeave(client: MmSocket): Promise<void> {
    const userId = client.data.userId;
    if (!userId) {
      return;
    }
    await this.matchmaking.dequeueAll(userId);
    await this.endActiveRoom(userId, 'stop');
  }

  // ── WebRTC signaling relays ──────────────────────────────────────────────────

  /** Relay an SDP offer to the peer after verifying room membership. */
  @SubscribeMessage('rtc:offer')
  async handleOffer(client: MmSocket, payload: RtcOfferPayload): Promise<void> {
    if (!(await this.allowSignal(client))) {
      return;
    }
    const parsed = rtcOfferPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    const peerId = await this.authorizedPeer(client, parsed.data.roomId);
    if (!peerId) {
      return;
    }
    this.server.to(userRoom(peerId)).emit('rtc:offer', parsed.data);
  }

  /** Relay an SDP answer to the peer after verifying room membership. */
  @SubscribeMessage('rtc:answer')
  async handleAnswer(client: MmSocket, payload: RtcAnswerPayload): Promise<void> {
    if (!(await this.allowSignal(client))) {
      return;
    }
    const parsed = rtcAnswerPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    const peerId = await this.authorizedPeer(client, parsed.data.roomId);
    if (!peerId) {
      return;
    }
    this.server.to(userRoom(peerId)).emit('rtc:answer', parsed.data);
  }

  /** Relay a trickled ICE candidate to the peer after verifying membership. */
  @SubscribeMessage('rtc:ice-candidate')
  async handleIce(client: MmSocket, payload: RtcIcePayload): Promise<void> {
    if (!(await this.allowSignal(client))) {
      return;
    }
    const parsed = rtcIcePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    const peerId = await this.authorizedPeer(client, parsed.data.roomId);
    if (!peerId) {
      return;
    }
    this.server.to(userRoom(peerId)).emit('rtc:ice-candidate', parsed.data);
  }

  /**
   * Hang up: end the room (durable match closed), notify the peer and detach
   * both sockets from the pair room. Idempotent against the disconnect path.
   */
  @SubscribeMessage('rtc:hangup')
  async handleHangup(client: MmSocket, payload: RtcHangupPayload): Promise<void> {
    const userId = client.data.userId;
    if (!userId) {
      return;
    }
    const parsed = rtcHangupPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    // Only allow hanging up a room the caller actually belongs to.
    if (!(await this.matchmaking.isMember(parsed.data.roomId, userId))) {
      return;
    }
    const teardown = await this.matchmaking.teardownRoom(userId, parsed.data.reason);
    if (teardown) {
      this.notifyPeerHangup(teardown.peerUserId, teardown.roomId, parsed.data.reason);
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  /**
   * Enqueue the user and attempt a match. On success wires the pair room and
   * emits `mm:matched` to both; otherwise emits `mm:waiting` to the joiner.
   */
  private async joinAndMatch(
    userId: string,
    socketId: string,
    payload: MmJoinPayload,
  ): Promise<void> {
    const waiter = await this.matchmaking.enqueue(userId, payload.type, payload.filters, socketId);
    if (!waiter) {
      // No profile / cannot match — signal waiting rather than erroring out.
      this.server.to(userRoom(userId)).emit('mm:waiting', {});
      return;
    }

    let result: MatchResult | null;
    try {
      result = await this.matchmaking.tryMatch(waiter, this.isConnected);
    } catch (err) {
      this.logger.debug(`tryMatch failed for ${userId}: ${asMessage(err)}`);
      result = null;
    }

    if (!result) {
      // A concurrent opposite-direction matcher may have ALREADY paired us (our
      // pool entry was claimed). Only signal "waiting" if we genuinely have no
      // active room yet — otherwise the peer's deliverMatch will emit
      // `mm:matched` and a spurious `mm:waiting` would race it.
      const activeRoom = await this.matchmaking.getUserRoom(userId);
      if (!activeRoom) {
        this.server.to(userRoom(userId)).emit('mm:waiting', {});
      }
      return;
    }

    this.deliverMatch(waiter, result);
  }

  /**
   * Emit `mm:matched` to each peer with the OTHER's info. The joiner is the
   * initiator (creates the SDP offer) — exactly one `isInitiator` is true.
   *
   * Delivery uses per-user rooms (every device joins `mm:user:<id>` on connect),
   * so each side is reached on whichever node holds its socket via the Redis
   * adapter. Authorization for the ensuing signaling is enforced against the
   * Redis room state ({@link MatchmakingService.getPeerOf}), so no Socket.io
   * pair room is needed.
   */
  private deliverMatch(joiner: WaiterEntry, result: MatchResult): void {
    const peerId = result.peer.userId;

    // One pairing made — bump the matches counter (fires exactly once per match,
    // on the joiner side that won the pairing).
    this.metrics.matchCreated();

    // Joiner is the initiator; the waiting peer answers.
    this.server.to(userRoom(joiner.userId)).emit('mm:matched', {
      roomId: result.roomId,
      type: result.type,
      peer: result.peerInfoForJoiner,
      isInitiator: true,
    });
    this.server.to(userRoom(peerId)).emit('mm:matched', {
      roomId: result.roomId,
      type: result.type,
      peer: result.peerInfoForPeer,
      isInitiator: false,
    });
  }

  /**
   * Per-user token-bucket gate for the `rtc:*` signaling relays. Returns `true`
   * when the caller is authenticated and within the signaling budget; emits a
   * `ws:error` and returns `false` when over the limit.
   */
  private async allowSignal(client: MmSocket): Promise<boolean> {
    const userId = client.data.userId;
    if (!userId) {
      return false;
    }
    if (!(await this.rateLimiter.consume(userId, RTC_SIGNAL_LIMIT))) {
      emitWsError(client, { code: 'rate_limited', event: 'rtc' });
      return false;
    }
    return true;
  }

  /**
   * Force-disconnect every local socket belonging to `userId` (invoked from the
   * cluster-wide ban channel). Uses the per-user room every socket joins on
   * connect; the Socket.io adapter scopes `disconnectSockets` to this node.
   */
  private async disconnectUser(userId: string): Promise<void> {
    try {
      const room = this.server.to(userRoom(userId));
      room.emit('ws:error', { code: 'banned', message: 'Account is banned' });
      // `close = true` fully severs the underlying connection, not just the ns.
      room.disconnectSockets(true);
      this.logger.debug(`force-disconnected sockets for banned user=${userId}`);
    } catch (err) {
      this.logger.debug(`disconnectUser failed for ${userId}: ${asMessage(err)}`);
    }
  }

  // ── Moderation enforcement (forced mid-call action) ─────────────────────────────

  /**
   * Open the dedicated subscriber on {@link MODERATION_ACTION_CHANNEL} and
   * dispatch each forced action to {@link applyModerationAction}. Mirrors the
   * subscribe-on-a-duplicated-connection pattern used by `WsAuthService`.
   */
  private async subscribeModerationActions(): Promise<void> {
    if (this.modActionSub) {
      return;
    }
    // A subscriber connection cannot issue normal commands, so duplicate.
    const sub = this.redis.duplicate();
    this.modActionSub = sub;
    sub.on('error', (err: Error) =>
      this.logger.error(`mod-action subscriber error: ${err.message}`),
    );
    sub.on('message', (channel: string, message: string) => {
      if (channel !== MODERATION_ACTION_CHANNEL) {
        return;
      }
      const parsed = parseModerationActionMessage(message);
      if (!parsed) {
        return;
      }
      void this.applyModerationAction(parsed.userId, parsed.payload);
    });
    try {
      await sub.subscribe(MODERATION_ACTION_CHANNEL);
    } catch (err) {
      this.logger.error(`failed to subscribe to mod-action channel: ${asMessage(err)}`);
    }
  }

  /**
   * Open the dedicated subscriber on {@link NOTIFICATION_NEW_CHANNEL} and emit
   * each delivered notification as `notif:new` to the recipient's per-user room.
   * Same subscribe-on-a-duplicated-connection pattern as the moderation channel;
   * the notifications module is the publisher (it has no gateway dependency).
   */
  private async subscribeNotifications(): Promise<void> {
    if (this.notifSub) {
      return;
    }
    // A subscriber connection cannot issue normal commands, so duplicate.
    const sub = this.redis.duplicate();
    this.notifSub = sub;
    sub.on('error', (err: Error) => this.logger.error(`notif subscriber error: ${err.message}`));
    sub.on('message', (channel: string, message: string) => {
      if (channel !== NOTIFICATION_NEW_CHANNEL) {
        return;
      }
      const parsed = parseNotificationMessage(message);
      if (!parsed) {
        return;
      }
      // Deliver to the recipient on whichever node holds their socket (the Redis
      // adapter fans `to(room)` out cluster-wide). A no-op if they're offline.
      this.server.to(userRoom(parsed.userId)).emit('notif:new', parsed.notification);
    });
    try {
      await sub.subscribe(NOTIFICATION_NEW_CHANNEL);
    } catch (err) {
      this.logger.error(`failed to subscribe to notif channel: ${asMessage(err)}`);
    }
  }

  /**
   * Deliver a forced moderation action to a user's live sockets on THIS node and
   * enforce the call-level side-effects:
   *  - always emit `mod:action` to the user's room (the client blurs/cuts and
   *    shows the reason);
   *  - on `kick` or `ban`, end the user's active call (peer gets `rtc:hangup`);
   *  - on `ban`, also sever the user's sockets (the cluster-wide `user:disconnect`
   *    channel handles other nodes; this is the local belt-and-braces drop).
   *
   * Idempotent and best-effort: a no-op (no live socket / no active room) is fine
   * since the ban flag + session revocation already make a ban effective.
   */
  async applyModerationAction(userId: string, payload: ModerationActionPayload): Promise<void> {
    try {
      this.server.to(userRoom(userId)).emit('mod:action', payload);
      if (payload.action === 'kick' || payload.action === 'ban') {
        // Closes the durable Match with reason 'reported' (the moderation-driven
        // end reason in the shared `matchEndReasonSchema`) and hangs up the peer.
        await this.endActiveRoom(userId, 'reported');
      }
      if (payload.action === 'ban') {
        await this.disconnectUser(userId);
      }
      this.logger.debug(`applied mod action=${payload.action} for user=${userId}`);
    } catch (err) {
      this.logger.debug(`applyModerationAction failed for ${userId}: ${asMessage(err)}`);
    }
  }

  /**
   * Resolve the caller's peer in `roomId`, enforcing that the caller is a
   * member. Returns the peer user id, or `null` (caller not a member / no room).
   */
  private async authorizedPeer(client: MmSocket, roomId: string): Promise<string | null> {
    const userId = client.data.userId;
    if (!userId) {
      return null;
    }
    return this.matchmaking.getPeerOf(roomId, userId);
  }

  /**
   * End whatever room the user is currently in (if any) and notify the peer
   * with a hangup so their call UI tears down.
   */
  private async endActiveRoom(userId: string, reason: MatchEndReason): Promise<void> {
    const teardown = await this.matchmaking.teardownRoom(userId, reason);
    if (!teardown) {
      return;
    }
    this.notifyPeerHangup(teardown.peerUserId, teardown.roomId, reason);
  }

  /** Emit `rtc:hangup` to the peer's user room so their call UI tears down. */
  private notifyPeerHangup(peerUserId: string, roomId: string, reason: MatchEndReason): void {
    this.server.to(userRoom(peerUserId)).emit('rtc:hangup', { roomId, reason });
  }
}

/**
 * Extract the raw handshake token. Accepts `auth.token` (the documented
 * channel) or an `Authorization: Bearer` header as a fallback. Verification +
 * shape-validation is delegated to {@link WsAuthService}.
 */
function extractToken(client: MmSocket): string | null {
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
function emitWsError(client: MmSocket, payload: WsErrorPayload): void {
  client.emit('ws:error', payload);
}

/**
 * Parse + validate a {@link MODERATION_ACTION_CHANNEL} message. The wire format
 * is JSON `{ userId, payload }`; the `payload` is re-validated against the
 * shared `moderationActionPayloadSchema` so a malformed publish can never drive
 * an enforcement action. Returns `null` on any parse/shape failure.
 */
function parseModerationActionMessage(
  raw: string,
): { userId: string; payload: ModerationActionPayload } | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null) {
    return null;
  }
  const userId = (json as { userId?: unknown }).userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    return null;
  }
  const payload = moderationActionPayloadSchema.safeParse((json as { payload?: unknown }).payload);
  if (!payload.success) {
    return null;
  }
  return { userId, payload: payload.data };
}

/**
 * Parse + validate a {@link NOTIFICATION_NEW_CHANNEL} message. The wire format is
 * JSON `{ userId, notification }`; the `notification` is re-validated against the
 * shared `appNotificationSchema` so a malformed publish can never be emitted to a
 * client. Returns `null` on any parse/shape failure.
 */
function parseNotificationMessage(
  raw: string,
): { userId: string; notification: AppNotification } | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null) {
    return null;
  }
  const userId = (json as { userId?: unknown }).userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    return null;
  }
  const notification = appNotificationSchema.safeParse(
    (json as { notification?: unknown }).notification,
  );
  if (!notification.success) {
    return null;
  }
  return { userId, notification: notification.data };
}

/** Narrows an unknown thrown value to a printable message. */
function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
