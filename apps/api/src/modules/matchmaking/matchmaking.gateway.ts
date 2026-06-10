import { Inject, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Redis } from 'ioredis';
import type { Namespace, Socket } from 'socket.io';

import {
  type AppNotification,
  appNotificationSchema,
  type CallInvitePayload,
  callInvitePayloadSchema,
  type CallResponsePayload,
  callResponsePayloadSchema,
  type ClientToServerEvents,
  type InterServerEvents,
  type MatchEndReason,
  type MmJoinPayload,
  mmJoinPayloadSchema,
  type ModerationActionPayload,
  moderationActionPayloadSchema,
  type OnlineStatus,
  type PresencePayload,
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
// The admin live-flag store (matchmaking kill-switch + maintenance). Aliased to
// avoid colliding with the per-user privacy `SettingsService` below.
import { SettingsService as LiveFlagsService } from '../admin/settings.service';
import { PresenceService } from '../presence/presence.service';
import { SettingsService } from '../settings/settings.service';
import {
  CALL_INVITE_LIMIT,
  MM_JOIN_LIMIT,
  RTC_SDP_LIMIT,
  RTC_SIGNAL_LIMIT,
  WS_HANDSHAKE_IP_LIMIT,
} from '../realtime-security/realtime-security.constants';
import type { RateLimitRule } from '../realtime-security/realtime-security.constants';
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

/**
 * Cross-instance channel on which the moderation module publishes a freshly
 * created block so the gateway force-ends any call in progress between the two
 * users. MUST stay identical to `BLOCK_ENFORCE_CHANNEL` in
 * `modules/moderation/moderation.constants.ts` (the string is duplicated rather
 * than imported, mirroring the `moderation:action` / `notif:new` /
 * `user:disconnect` channels, to keep the gateway free of a value-import
 * dependency on the moderation module).
 *
 * Wire contract: JSON `{ userId: string, blockedUserId: string }`. The gateway
 * tears down the room ONLY if those two users are currently matched together.
 */
const BLOCK_ENFORCE_CHANNEL = 'block:enforce';
import { WsRateLimiterService } from '../realtime-security/ws-rate-limiter.service';
import { CallService } from './call.service';
import {
  ACTIVE_CALL_TTL_SECONDS,
  activeCallIdKey,
  activeCallPairKey,
  callRoom,
} from './matchmaking.constants';
import {
  type ConnectionVerifier,
  type MatchResult,
  MatchmakingService,
} from './matchmaking.service';
import type { WaiterEntry } from './matchmaking.types';

/** Socket typed with the shared client→server map + per-connection data. */
type MmSocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

/**
 * Room a socket joins (per subscribed user id) to receive that user's presence
 * transitions. The Socket.io Redis adapter fans `to(room)` out cluster-wide, so
 * a watcher on one replica still sees a transition published from another.
 */
function presenceWatchRoom(userId: string): string {
  return `presence:watch:${userId}`;
}

/**
 * Cadence (ms) of the per-node presence heartbeat: re-arm the connection-counter
 * + status TTL for every locally-connected user so an active user never lapses
 * to offline mid-session, while a crashed replica's counts still self-heal once
 * their (un-refreshed) TTL elapses. Comfortably shorter than
 * `PRESENCE_CONN_TTL_SECONDS` so a single missed beat can't flap anyone offline.
 */
const PRESENCE_HEARTBEAT_MS = 30_000;

/**
 * Max user ids one socket may watch via a single `presence:subscribe`. The
 * friends list / chat header watch a small, bounded set; this caps a socket
 * joining an unbounded number of watch rooms.
 */
const PRESENCE_WATCH_LIMIT = 500;

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
 * Presence ({@link PresenceService}, Redis-backed, cross-replica): a per-user
 * GLOBAL connection counter is bumped on connect / dropped on disconnect, so a
 * user with sockets on multiple replicas is online ONCE — the 0→1 edge flips
 * them `online` and the →0 edge `offline`, each published cluster-wide. A
 * per-node heartbeat re-arms the counter/status TTL for live sockets (a crashed
 * replica self-heals once its counts lapse). `presence:subscribe(userIds)` joins
 * this socket to each `presence:watch:<id>` room and replies with each id's
 * current status; transitions are relayed to those rooms (fanned cross-replica
 * by the Redis adapter) as `presence:online`/`presence:offline`.
 *
 * Direct (friend) calls ({@link CallService}, Redis-backed): `call:invite`
 * (rate-limited, block-gated, offline-callee short-circuited) mints a `callId`,
 * stores a pending call with a ring TTL and relays `call:invite` to the callee's
 * per-user room; `call:accept` validates the pending call, joins BOTH parties to
 * a `call:<callId>` room and relays `call:accept` to the caller; `call:decline`
 * /`call:end` relay to the other party and clear/teardown. The call's WebRTC
 * media reuses the `rtc:*` relays with `roomId = callId`.
 *
 * Signaling (server only relays SDP/ICE; media is P2P): `rtc:offer`,
 * `rtc:answer`, `rtc:ice-candidate`, `rtc:hangup` are validated, per-user
 * rate-limited and relayed to the OTHER party of `roomId` — generalised over
 * BOTH a matchmaking room (authorised via Redis room state → peer's user room)
 * AND a friend-call `call:<callId>` room (authorised via Socket.io membership →
 * the room's other members), so `roomId = callId` works for friend calls.
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

  /** Dedicated SUBSCRIBE connection for the block-enforce channel. */
  private blockSub?: Redis;

  /** Unsubscribe handle for the cluster-wide presence-transition relay. */
  private presenceUnsub?: () => void;

  /** Periodic presence-heartbeat timer (re-arms TTLs for local sockets). */
  private presenceHeartbeat?: ReturnType<typeof setInterval>;

  constructor(
    private readonly matchmaking: MatchmakingService,
    private readonly calls: CallService,
    private readonly presence: PresenceService,
    private readonly settings: SettingsService,
    private readonly liveFlags: LiveFlagsService,
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
    void this.subscribeBlockEnforce();
    // Relay cluster-wide presence transitions to the sockets watching that user
    // (`presence:watch:<id>` rooms). The Redis adapter fans the emit out, so a
    // transition published on ANY replica reaches watchers on every replica.
    this.presenceUnsub = this.presence.onPresenceEvent((payload) => {
      void this.relayPresence(payload);
    });
    // Re-arm presence TTLs for this node's connected users so an active user
    // never lapses offline mid-session (a crashed replica still self-heals).
    this.presenceHeartbeat = setInterval(() => {
      void this.beatPresence();
    }, PRESENCE_HEARTBEAT_MS);
    // Don't keep the event loop alive on shutdown solely for the heartbeat.
    this.presenceHeartbeat.unref?.();
  }

  /**
   * Close the dedicated moderation-action + notification + block-enforce
   * subscribers, drop the presence relay subscription and stop the presence
   * heartbeat on shutdown.
   */
  async onModuleDestroy(): Promise<void> {
    this.presenceUnsub?.();
    if (this.presenceHeartbeat) {
      clearInterval(this.presenceHeartbeat);
    }
    for (const sub of [this.modActionSub, this.notifSub, this.blockSub]) {
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

  /**
   * Batched, cluster-wide liveness oracle for one match pass: returns the subset
   * of `userIds` that still hold a live connection anywhere in the cluster. Backed
   * by a single presence MGET ({@link PresenceService.getStatuses}) on the per-user
   * connection-refcount-driven status keys — one Redis round-trip for the whole
   * pass — replacing the prior per-candidate `fetchSockets` adapter fan-out. A
   * user with no live connection is `offline` and omitted, so a stale waiter is
   * skipped + evicted exactly as before. A presence read failure fails OPEN
   * (treat every candidate as live) so a transient Redis blip can't empty the pool.
   */
  private get isConnected(): ConnectionVerifier {
    return async (userIds: readonly string[]): Promise<Set<string>> => {
      if (userIds.length === 0) {
        return new Set();
      }
      try {
        const statuses = await this.presence.getStatuses([...userIds]);
        const live = new Set<string>();
        for (const id of userIds) {
          // Any non-`offline` status means the user has a live connection
          // (the 0→1 connect edge flips them online; the →0 disconnect edge
          // back to offline) — the exact liveness signal a stale waiter lacks.
          if ((statuses[id] ?? 'offline') !== 'offline') {
            live.add(id);
          }
        }
        return live;
      } catch (err) {
        this.logger.debug(`presence liveness lookup failed: ${asMessage(err)}`);
        return new Set(userIds);
      }
    };
  }

  // ── Connection lifecycle ─────────────────────────────────────────────────────

  /**
   * Per-IP pre-auth handshake throttle, verify the handshake token (HS256-pinned
   * + shape-validated), reject banned accounts, enforce the per-user
   * concurrent-socket cap, then bind identity and join the per-user room.
   */
  async handleConnection(client: MmSocket): Promise<void> {
    // Per-IP handshake rate limit BEFORE any DB work (the ban-check below). The
    // per-user socket cap only applies post-auth and is keyed on a verified
    // token, so without this an unauthenticated client could loop handshakes
    // from one IP. Defence-in-depth alongside the nginx `limit_req` on
    // `/socket.io`. Cheap Redis-only check; a missing/blank IP is allowed
    // through (nginx is the edge defence there).
    const ip = extractClientIp(client);
    if (!(await this.rateLimiter.consumeHandshakeIp(ip, WS_HANDSHAKE_IP_LIMIT))) {
      emitWsError(client, { code: 'rate_limited', message: 'Too many connection attempts' });
      client.disconnect(true);
      return;
    }
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
    // Bump the GLOBAL connection refcount; the 0→1 edge flips the user online
    // (published cluster-wide → relayed to their watchers). Best-effort: a
    // presence write must never block a healthy socket from connecting.
    await this.presence.connect(payload.sub).catch((err: unknown) => {
      this.logger.debug(`presence.connect failed for ${payload.sub}: ${asMessage(err)}`);
    });
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
      // Drop the GLOBAL connection refcount; the →0 edge flips the user offline
      // (published cluster-wide → relayed to their watchers). A user still
      // holding a socket on another replica stays online.
      await this.presence.disconnect(userId);
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
    // Live matchmaking kill-switch (admin-toggleable, no restart): when the pool
    // is disabled, refuse the join with a `ws:error` so the client can show a
    // "temporarily unavailable" state instead of spinning on 'searching'. The
    // public `/public/status` read lets the UI pre-disable "start", but this is
    // the enforcement point. STUN/`forbidden` is the closest stable code token.
    if (!(await this.liveFlags.isMatchmakingEnabled())) {
      emitWsError(client, {
        code: 'forbidden',
        event: 'mm:join',
        message: 'Matchmaking is temporarily unavailable',
      });
      return;
    }
    const parsed = mmJoinPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.debug(`mm:join rejected for ${userId}: invalid payload`);
      return;
    }

    // Re-joining WHILE ALREADY IN A ROOM is a re-roll: it must be charged to the
    // stricter `mm:next` skip throttle, not the laxer `MM_JOIN_LIMIT` outer guard
    // consumed above. Otherwise a user in a room could `mm:join`-spam to re-roll
    // far faster than the 10/10s `mm:next` ceiling allows — doubling the
    // peer-fishing / deanonymization rate. The `MM_JOIN_LIMIT` consume stays as
    // the outer first-join guard; this adds the skip-ceiling on the in-room path.
    const inRoom = await this.matchmaking.getUserRoom(userId);
    if (inRoom) {
      if (!(await this.consumeSkipToken(client))) {
        // Over the skip ceiling — keep the user in their current room (no
        // teardown) so they can re-roll once the cooldown lapses.
        return;
      }
      // End the old room (treated as a voluntary stop) so we never leak a room.
      await this.endActiveRoom(userId, 'stop');
    }

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
    if (!(await this.consumeSkipToken(client))) {
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

  // ── Presence ─────────────────────────────────────────────────────────────────

  /**
   * Subscribe THIS socket to the live presence of `userIds`: join each user's
   * `presence:watch:<id>` room (so cluster-wide transitions are fanned here by
   * the Redis adapter) and immediately reply with each requested user's CURRENT
   * status as `presence:online`/`presence:offline`, so the client renders the
   * right state before any transition fires. Watch rooms are left automatically
   * on disconnect. Capped to a sane batch so one socket can't watch unbounded
   * ids (the friends list / chat header watch a small, bounded set).
   */
  @SubscribeMessage('presence:subscribe')
  async handlePresenceSubscribe(client: MmSocket, userIds: string[]): Promise<void> {
    const watcher = client.data.userId;
    if (!watcher || !Array.isArray(userIds)) {
      return;
    }
    // De-dupe + bound + keep only well-formed ids (the contract's PresencePayload
    // uses objectIdSchema, but the subscribe event itself is a raw string[]).
    const ids = Array.from(new Set(userIds))
      .filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 64)
      .slice(0, PRESENCE_WATCH_LIMIT);
    if (ids.length === 0) {
      return;
    }
    await Promise.all(ids.map((id) => client.join(presenceWatchRoom(id))));

    // Reply with the current status of each requested id (one Redis round-trip).
    let statuses: Record<string, OnlineStatus>;
    try {
      statuses = await this.presence.getStatuses(ids);
    } catch (err) {
      this.logger.debug(`presence:subscribe lookup failed for ${watcher}: ${asMessage(err)}`);
      return;
    }
    // The watcher is some OTHER user, so honour each subject's `showOnlineStatus`
    // — a subject who hides it is reported offline in the initial snapshot too.
    for (const id of ids) {
      const masked = await this.maskHiddenPresence({ userId: id, status: statuses[id] ?? 'offline' });
      this.emitPresenceTo(client, masked);
    }
  }

  // ── Direct (friend) calls ──────────────────────────────────────────────────────

  /**
   * Place a 1:1 call to a friend. Rate-limited per caller. A self-call is
   * ignored; a block (either direction) is refused with `ws:error` and never
   * surfaced to the callee. If the callee is currently OFFLINE we reply
   * `ws:error` to the caller at once so their "calling…" UI resolves instead of
   * ringing out. Otherwise we mint a `callId`, persist the pending call with a
   * ring TTL and relay `call:invite` to the callee's per-user room (reachable on
   * any replica via the Redis adapter) — which opens their incoming-call modal.
   */
  @SubscribeMessage('call:invite')
  async handleCallInvite(client: MmSocket, payload: CallInvitePayload): Promise<void> {
    const fromUserId = client.data.userId;
    if (!fromUserId) {
      return;
    }
    if (!(await this.rateLimiter.consume(fromUserId, CALL_INVITE_LIMIT))) {
      emitWsError(client, { code: 'rate_limited', event: 'call:invite' });
      return;
    }
    const parsed = callInvitePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    const { toUserId, type } = parsed.data;
    // Can't call yourself.
    if (toUserId === fromUserId) {
      return;
    }
    // Respect blocks in either direction — don't even surface the invite.
    if (await this.matchmaking.isBlockedEitherWay(fromUserId, toUserId)) {
      emitWsError(client, { code: 'forbidden', event: 'call:invite' });
      return;
    }
    // Offline callee → tell the caller now so their "calling…" UI resolves
    // instead of ringing out. The contract permits `call:decline` OR a
    // `ws:error` here; we use `ws:error` because no `callId` has been minted yet
    // (the invite carries none), so there is nothing for a `call:decline
    // { callId }` to correlate against on the caller.
    if (!(await this.presence.isOnline(toUserId))) {
      emitWsError(client, { code: 'forbidden', event: 'call:invite', message: 'User is offline' });
      return;
    }
    // Honour the callee's `whoCanCall` privacy — the SAME gate the roulette path
    // applies to every pairing (`mutualCanCall`). Without it a user who set
    // `whoCanCall` to 'nobody' / 'friends' could still be rung directly by anyone
    // who knows their userId (the wave-5 privacy bypass). Refuse before minting a
    // pending call or reaching the callee's room, exactly like the block gate.
    if (!(await this.matchmaking.canCallDirect(fromUserId, toUserId))) {
      emitWsError(client, { code: 'forbidden', event: 'call:invite' });
      return;
    }

    const call = await this.calls.createPending(fromUserId, toUserId, type);
    // Relay the invite to all of the callee's devices on any replica. This is
    // what opens their incoming-call modal (the modal host listens for
    // `call:invite`). A persisted `notif:new` is intentionally NOT raised here:
    // a correctly-localised, stored notification belongs to the notifications
    // module, and the live invite already drives the ring UI — emitting a
    // placeholder notification would surface raw, unlocalised text in the bell.
    this.server.to(userRoom(toUserId)).emit('call:invite', {
      toUserId,
      type,
      callId: call.callId,
      fromUserId,
    });
  }

  /**
   * Accept a ringing call. Validates the pending call is addressed to THIS user
   * (atomic consume — single-use, racing decline loses), relays `call:accept` to
   * the CALLER and puts BOTH parties' sockets into the `call:<callId>` room so
   * the subsequent `rtc:*` signaling (with `roomId = callId`) relays between
   * them exactly like a matchmaking room.
   */
  @SubscribeMessage('call:accept')
  async handleCallAccept(client: MmSocket, payload: CallResponsePayload): Promise<void> {
    const userId = client.data.userId;
    if (!userId) {
      return;
    }
    const parsed = callResponsePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    const call = await this.calls.consumePendingForCallee(parsed.data.callId, userId);
    if (!call) {
      // Already answered / declined / rang out, or not addressed to this user.
      return;
    }
    // Re-check the block AFTER consuming the pending call: a block may have been
    // created during the ring (between `call:invite`'s gate and this accept). If
    // either party blocked the other, ABORT — never join them to the call room.
    // Tell BOTH sides the call ended so the caller's "calling…" UI and the
    // callee's incoming-call modal both resolve. The pending call is already
    // consumed, so no further teardown of it is needed.
    if (await this.matchmaking.isBlockedEitherWay(call.fromUserId, call.toUserId)) {
      this.server.to(userRoom(call.fromUserId)).emit('call:end', { callId: call.callId });
      this.server.to(userRoom(call.toUserId)).emit('call:end', { callId: call.callId });
      this.logger.debug(`call:accept aborted (blocked) call=${call.callId}`);
      return;
    }
    // Index this now-active call by its participant pair BEFORE joining the
    // sockets, so a block created mid-call (`block:enforce` → `endCallBetween`,
    // which finds the call via the pair index) can never land in the window
    // between the room going live and the index being written and so MISS the
    // pair — which would leave an accepted call surviving a block. Best-effort: a
    // failed index write must not block a healthy accept (the call ring TTL +
    // room teardown still bound any leak). Mirrors AuditService.log's
    // awaited-but-swallowed side-effect.
    await this.indexActiveCall(call.callId, call.fromUserId, call.toUserId);
    // RE-CHECK the block once more AFTER indexing: a block:enforce that fired in
    // the gap between the first check and the index write would have looked up an
    // empty pair index and done nothing, so close that race by re-reading the
    // block now that the call is discoverable. If a block landed, tear the call
    // down (call:end + rtc:hangup reason 'reported' + clear the index) instead of
    // joining/accepting — both sides' UIs resolve and nothing is left live.
    if (await this.matchmaking.isBlockedEitherWay(call.fromUserId, call.toUserId)) {
      this.server.to(userRoom(call.fromUserId)).emit('call:end', { callId: call.callId });
      this.server.to(userRoom(call.toUserId)).emit('call:end', { callId: call.callId });
      this.server
        .to(userRoom(call.fromUserId))
        .emit('rtc:hangup', { roomId: callRoom(call.callId), reason: 'reported' });
      this.server
        .to(userRoom(call.toUserId))
        .emit('rtc:hangup', { roomId: callRoom(call.callId), reason: 'reported' });
      await this.teardownCallRoom(call.callId);
      this.logger.debug(`call:accept aborted (blocked after index) call=${call.callId}`);
      return;
    }
    // Put BOTH users' sockets (every device, on every replica) into the call
    // room so `rtc:*` relays between them. `socketsJoin` is fanned out by the
    // Redis adapter, so a participant connected to another node joins too. AWAIT
    // both joins BEFORE telling the caller to start: otherwise the caller's
    // first `rtc:offer` could arrive before its socket is in the room and be
    // dropped by the membership gate.
    const room = callRoom(call.callId);
    await Promise.all([
      this.server.in(userRoom(call.fromUserId)).socketsJoin(room),
      this.server.in(userRoom(call.toUserId)).socketsJoin(room),
    ]);
    // Tell the caller the call was accepted so they begin WebRTC negotiation.
    this.server.to(userRoom(call.fromUserId)).emit('call:accept', { callId: call.callId });
  }

  /**
   * Decline a ringing call. Validates + consumes the pending call (so it can't
   * also be accepted) and relays `call:decline` to the caller so their ring UI
   * resolves.
   */
  @SubscribeMessage('call:decline')
  async handleCallDecline(client: MmSocket, payload: CallResponsePayload): Promise<void> {
    const userId = client.data.userId;
    if (!userId) {
      return;
    }
    const parsed = callResponsePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    const call = await this.calls.consumePendingForCallee(parsed.data.callId, userId);
    if (!call) {
      return;
    }
    this.server.to(userRoom(call.fromUserId)).emit('call:decline', { callId: call.callId });
  }

  /**
   * End a call. Two phases are covered:
   *  - BEFORE accept (caller cancels a still-ringing invite): clear the pending
   *    call and relay `call:end` to the callee so their incoming-call modal
   *    closes.
   *  - AFTER accept (either party hangs up): relay `call:end` to the OTHER
   *    member of the `call:<callId>` room and tear the room down.
   * Either party may end; we never trust the client's view of who the peer is —
   * delivery is by pending-call record (pre-accept) or room membership (post-).
   */
  @SubscribeMessage('call:end')
  async handleCallEnd(client: MmSocket, payload: CallResponsePayload): Promise<void> {
    const userId = client.data.userId;
    if (!userId) {
      return;
    }
    const parsed = callResponsePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    const callId = parsed.data.callId;

    // Pre-accept: a pending call still exists → caller (or callee) cancelled.
    const pending = await this.calls.getPending(callId);
    if (pending) {
      // Only a participant may cancel the ring.
      if (pending.fromUserId !== userId && pending.toUserId !== userId) {
        return;
      }
      const cleared = await this.calls.clearPending(callId);
      if (cleared) {
        const other = cleared.fromUserId === userId ? cleared.toUserId : cleared.fromUserId;
        this.server.to(userRoom(other)).emit('call:end', { callId });
      }
      return;
    }

    // Post-accept: relay to the other room member and tear the room down. Gated
    // on the socket actually being in the call room.
    if (this.isInCallRoom(client, callId)) {
      client.to(callRoom(callId)).emit('call:end', { callId });
      await this.teardownCallRoom(callId);
    }
  }

  // ── WebRTC signaling relays ──────────────────────────────────────────────────

  /** Relay an SDP offer to the peer after verifying room membership. */
  @SubscribeMessage('rtc:offer')
  async handleOffer(client: MmSocket, payload: RtcOfferPayload): Promise<void> {
    if (!(await this.allowSignal(client, RTC_SDP_LIMIT))) {
      return;
    }
    const parsed = rtcOfferPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    await this.relaySignal(client, parsed.data.roomId, 'rtc:offer', parsed.data);
  }

  /** Relay an SDP answer to the peer after verifying room membership. */
  @SubscribeMessage('rtc:answer')
  async handleAnswer(client: MmSocket, payload: RtcAnswerPayload): Promise<void> {
    if (!(await this.allowSignal(client, RTC_SDP_LIMIT))) {
      return;
    }
    const parsed = rtcAnswerPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    await this.relaySignal(client, parsed.data.roomId, 'rtc:answer', parsed.data);
  }

  /** Relay a trickled ICE candidate to the peer after verifying membership. */
  @SubscribeMessage('rtc:ice-candidate')
  async handleIce(client: MmSocket, payload: RtcIcePayload): Promise<void> {
    if (!(await this.allowSignal(client, RTC_SIGNAL_LIMIT))) {
      return;
    }
    const parsed = rtcIcePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    await this.relaySignal(client, parsed.data.roomId, 'rtc:ice-candidate', parsed.data);
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
    const { roomId, reason } = parsed.data;
    // Matchmaking room: tear down the durable match + notify the peer.
    if (await this.matchmaking.isMember(roomId, userId)) {
      const teardown = await this.matchmaking.teardownRoom(userId, reason);
      if (teardown) {
        this.notifyPeerHangup(teardown.peerUserId, teardown.roomId, reason);
      }
      return;
    }
    // Friend-call room (`call:<callId>`): relay the hangup to the OTHER member
    // and tear the call room down. Gated on the socket actually being a member.
    if (this.isInCallRoom(client, roomId)) {
      client.to(callRoom(roomId)).emit('rtc:hangup', { roomId, reason });
      await this.teardownCallRoom(roomId);
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  /**
   * Consume one `mm:next` skip token for this socket's user, the SINGLE throttle
   * governing every re-roll: an explicit `mm:next`, AND an `mm:join` issued while
   * already in a room (which is a re-roll in disguise). Returns `true` when within
   * the {@link NEXT_MAX_PER_WINDOW}/{@link NEXT_WINDOW_SECONDS} budget; on `false`
   * emits `ws:error({ code: 'rate_limited', event: 'mm:next' })` so the client can
   * recover (keep its current peer, re-issue once the cooldown lapses) instead of
   * stranding the user on 'searching'. Centralising both re-roll paths here stops
   * `mm:join` from bypassing the stricter skip ceiling via the laxer join guard.
   */
  private async consumeSkipToken(client: MmSocket): Promise<boolean> {
    const userId = client.data.userId;
    if (!userId) {
      return false;
    }
    if (!(await this.matchmaking.consumeNextToken(userId))) {
      this.logger.debug(`mm:next rate-limited for ${userId}`);
      emitWsError(client, { code: 'rate_limited', event: 'mm:next' });
      return false;
    }
    return true;
  }

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
   * Delivery targets the SINGLE socket each side joined the pool on — the one
   * bound into the room state ({@link MatchResult.peer.socketId} for the peer,
   * `joiner.socketId` for the joiner). Routing to the bound socket (reached on
   * any node by `server.to(socketId)`, since a socket id is itself a room) rather
   * than the per-user room means a user running the roulette on several devices
   * only ever has ONE device enter this call — preventing the multi-device
   * double-initiate where two devices of the same user both answer/offer.
   * Authorization for the ensuing signaling is enforced against the Redis room
   * state ({@link MatchmakingService.getRelayTarget}), so no Socket.io pair room
   * is needed.
   */
  private deliverMatch(joiner: WaiterEntry, result: MatchResult): void {
    const peer = result.peer;

    // One pairing made — bump the matches counter (fires exactly once per match,
    // on the joiner side that won the pairing).
    this.metrics.matchCreated();

    // Joiner is the initiator; the waiting peer answers. `server.to(socketId)`
    // is the single bound device for each side (a socket id IS a room name); the
    // Redis adapter still fans it to the node holding that socket.
    this.server.to(joiner.socketId).emit('mm:matched', {
      roomId: result.roomId,
      type: result.type,
      peer: result.peerInfoForJoiner,
      isInitiator: true,
    });
    this.server.to(peer.socketId).emit('mm:matched', {
      roomId: result.roomId,
      type: result.type,
      peer: result.peerInfoForPeer,
      isInitiator: false,
    });
  }

  /**
   * Per-user token-bucket gate for the `rtc:*` signaling relays. Returns `true`
   * when the caller is authenticated and within the budget for `rule`; emits a
   * `ws:error` and returns `false` when over the limit. SDP (offer/answer) and
   * ICE candidates pass DIFFERENT rules so the chatty ICE stream can never
   * exhaust the budget a call-critical offer/answer needs.
   */
  private async allowSignal(client: MmSocket, rule: RateLimitRule): Promise<boolean> {
    const userId = client.data.userId;
    if (!userId) {
      return false;
    }
    if (!(await this.rateLimiter.consume(userId, rule))) {
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
   * Open the dedicated subscriber on {@link BLOCK_ENFORCE_CHANNEL} and force-end
   * any call in progress between the two users of each block. Same
   * subscribe-on-a-duplicated-connection pattern as the moderation/notification
   * channels; the moderation module is the publisher (it has no gateway
   * dependency, avoiding a `MatchmakingModule` cycle).
   */
  private async subscribeBlockEnforce(): Promise<void> {
    if (this.blockSub) {
      return;
    }
    // A subscriber connection cannot issue normal commands, so duplicate.
    const sub = this.redis.duplicate();
    this.blockSub = sub;
    sub.on('error', (err: Error) =>
      this.logger.error(`block-enforce subscriber error: ${err.message}`),
    );
    sub.on('message', (channel: string, message: string) => {
      if (channel !== BLOCK_ENFORCE_CHANNEL) {
        return;
      }
      const parsed = parseBlockEnforceMessage(message);
      if (!parsed) {
        return;
      }
      // A block must cut BOTH room kinds the two users could share: the durable
      // matchmaking room AND an accepted 1:1 friend call (indexed by pair).
      void this.endRoomBetween(parsed.userId, parsed.blockedUserId);
      void this.endCallBetween(parsed.userId, parsed.blockedUserId);
    });
    try {
      await sub.subscribe(BLOCK_ENFORCE_CHANNEL);
    } catch (err) {
      this.logger.error(`failed to subscribe to block-enforce channel: ${asMessage(err)}`);
    }
  }

  /**
   * Force-end the active matchmaking room between `userA` and `userB` IFF they
   * are currently each other's peer — so a block instantly cuts a call in
   * progress between the two, while never disturbing an unrelated call either of
   * them happens to be in. Both sides get `rtc:hangup` (reason `reported`) and
   * the durable {@link Match} is closed.
   *
   * Idempotent + best-effort: if they aren't matched together (the common case)
   * this is a cheap no-op. A no-op also covers the cross-replica case where
   * neither holds a socket here — the authoritative room state lives in Redis,
   * so `teardownRoom` works regardless of which node the sockets are on, and the
   * `rtc:hangup` emits are fanned out cluster-wide by the Redis adapter.
   */
  private async endRoomBetween(userA: string, userB: string): Promise<void> {
    try {
      const pointer = await this.matchmaking.getUserRoom(userA);
      if (!pointer) {
        return;
      }
      const peer = await this.matchmaking.getPeerOf(pointer.roomId, userA);
      if (peer !== userB) {
        // userA is not in a room, or is matched with someone else — leave it.
        return;
      }
      // They ARE matched together: tear the room down and hang up both sides.
      // `teardownRoom` returns the peer so we notify them; userA is notified
      // explicitly since they initiated the block (their call UI must also drop).
      const teardown = await this.matchmaking.teardownRoom(userA, 'reported');
      if (!teardown) {
        return;
      }
      this.notifyPeerHangup(teardown.peerUserId, teardown.roomId, 'reported');
      this.notifyPeerHangup(userA, teardown.roomId, 'reported');
      this.logger.debug(`block force-ended room ${teardown.roomId} between ${userA} and ${userB}`);
    } catch (err) {
      this.logger.debug(`endRoomBetween(${userA},${userB}) failed: ${asMessage(err)}`);
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
   * Relay a `rtc:*` signal to the other party of `roomId`, generalised over BOTH
   * room kinds the gateway hosts:
   *  - a MATCHMAKING room — authorise via the authoritative Redis room state and
   *    emit to the peer's BOUND socket (the single device that won the pairing),
   *    delivered cross-replica by the adapter. A signal from a socket that is NOT
   *    the sender's bound device for this room is DROPPED — so a user's second
   *    device (same user id, different socket) can't inject offers/answers into a
   *    call the first device owns (the multi-device double-initiate). Rooms
   *    persisted before socket binding (`selfSocket`/`peerSocket` null) fall back
   *    to per-user-room routing, preserving prior behaviour.
   *  - a FRIEND-CALL room (`call:<callId>`) — authorise by the sender actually
   *    being a member of the Socket.io room and broadcast to the OTHER members.
   * A socket that belongs to neither (spoofed / stale `roomId`) gets nothing.
   */
  private async relaySignal(
    client: MmSocket,
    roomId: string,
    event: 'rtc:offer' | 'rtc:answer' | 'rtc:ice-candidate',
    payload: RtcOfferPayload | RtcAnswerPayload | RtcIcePayload,
  ): Promise<void> {
    const userId = client.data.userId;
    if (userId) {
      const target = await this.matchmaking.getRelayTarget(roomId, userId);
      if (target) {
        // Reject a signal from a non-bound socket: only the device bound into the
        // room may drive this call. `selfSocket` null = legacy room → no binding
        // to enforce, so allow (prior behaviour).
        if (target.selfSocket !== null && target.selfSocket !== client.id) {
          this.logger.debug(
            `dropped ${event} from non-bound socket ${client.id} for user=${userId} room=${roomId}`,
          );
          return;
        }
        // Route to the peer's bound device; fall back to their per-user room on a
        // legacy room where no socket was bound.
        const dest = target.peerSocket ?? userRoom(target.peerUserId);
        this.server.to(dest).emit(event, payload as never);
        return;
      }
    }
    if (this.isInCallRoom(client, roomId)) {
      // `client.to(room)` excludes the sender → goes to the other member(s) only.
      client.to(callRoom(roomId)).emit(event, payload as never);
    }
  }

  /** Whether this socket is currently a member of the `call:<callId>` room. */
  private isInCallRoom(client: MmSocket, callId: string): boolean {
    return client.rooms.has(callRoom(callId));
  }

  /**
   * Detach every socket (on any replica) from a friend-call room once the call
   * ends, so a stale `call:<callId>` membership can never relay future signals.
   * `socketsLeave` is fanned out cluster-wide by the Redis adapter. Also clears
   * the accepted-call index for this call so a later block can't resurrect a
   * torn-down call from a stale pair entry.
   */
  private async teardownCallRoom(callId: string): Promise<void> {
    try {
      await this.calls.clearPending(callId);
      await this.clearActiveCallIndex(callId);
      this.server.in(callRoom(callId)).socketsLeave(callRoom(callId));
    } catch (err) {
      this.logger.debug(`teardownCallRoom failed for ${callId}: ${asMessage(err)}`);
    }
  }

  /**
   * Index an ACCEPTED 1:1 friend call so a block created mid-call
   * ({@link BLOCK_ENFORCE_CHANNEL}) can find and tear it down without knowing its
   * `callId`. Writes two TTL'd keys: the unordered participant pair →
   * {@link activeCallPairKey} → `callId`, and the reverse `callId` →
   * {@link activeCallIdKey} → `{a,b}` so teardown can clear the pair entry without
   * re-deriving it. Best-effort: a failed index write must not block a healthy
   * accept — the call ring TTL + room teardown still bound any leak.
   */
  private async indexActiveCall(
    callId: string,
    fromUserId: string,
    toUserId: string,
  ): Promise<void> {
    try {
      await this.redis
        .multi()
        .set(activeCallPairKey(fromUserId, toUserId), callId, 'EX', ACTIVE_CALL_TTL_SECONDS)
        .set(
          activeCallIdKey(callId),
          JSON.stringify({ a: fromUserId, b: toUserId }),
          'EX',
          ACTIVE_CALL_TTL_SECONDS,
        )
        .exec();
    } catch (err) {
      this.logger.debug(`indexActiveCall failed for ${callId}: ${asMessage(err)}`);
    }
  }

  /**
   * Clear the accepted-call index for `callId` (both the reverse `callId`→pair
   * key and the pair→`callId` key). Reads the reverse key to learn the pair, then
   * deletes both. Idempotent: a missing/expired index is a cheap no-op.
   *
   * The pair key is deleted with a COMPARE-AND-DELETE keyed on THIS `callId`: a
   * stale teardown of an OLD call between the same two users must not clobber the
   * pair index of a NEWER live call that has since reused the (unordered) pair
   * key — which would make a later block:enforce unable to find + tear down the
   * newer call. The reverse `callId`→pair key is unique to this call, so it is
   * deleted unconditionally.
   */
  private async clearActiveCallIndex(callId: string): Promise<void> {
    try {
      const raw = await this.redis.get(activeCallIdKey(callId));
      await this.redis.del(activeCallIdKey(callId));
      if (raw) {
        const pair = JSON.parse(raw) as { a?: unknown; b?: unknown };
        if (typeof pair.a === 'string' && typeof pair.b === 'string') {
          // Only delete the pair key if it STILL points at this callId; if a
          // newer call already overwrote it, leave the newer entry intact.
          await this.redis.eval(
            COMPARE_AND_DEL_LUA,
            1,
            activeCallPairKey(pair.a, pair.b),
            callId,
          );
        }
      }
    } catch (err) {
      this.logger.debug(`clearActiveCallIndex failed for ${callId}: ${asMessage(err)}`);
    }
  }

  /**
   * Force-end any ACCEPTED friend call in progress between `userA` and `userB`
   * when a block is created. Looks the call up by the unordered participant pair
   * ({@link activeCallPairKey}); if one exists, tells BOTH sides the call ended
   * (`call:end` for the call UI, `rtc:hangup` reason `reported` for the WebRTC
   * teardown) and detaches every socket from the `call:<callId>` room
   * cluster-wide via {@link teardownCallRoom}. Idempotent + best-effort: no
   * indexed call (the common case) is a cheap no-op. Runs regardless of which
   * node holds the sockets — the emits + `socketsLeave` are fanned out by the
   * Redis adapter.
   */
  private async endCallBetween(userA: string, userB: string): Promise<void> {
    try {
      const callId = await this.redis.get(activeCallPairKey(userA, userB));
      if (!callId) {
        return;
      }
      this.server.to(userRoom(userA)).emit('call:end', { callId });
      this.server.to(userRoom(userB)).emit('call:end', { callId });
      this.server.to(userRoom(userA)).emit('rtc:hangup', { roomId: callRoom(callId), reason: 'reported' });
      this.server.to(userRoom(userB)).emit('rtc:hangup', { roomId: callRoom(callId), reason: 'reported' });
      await this.teardownCallRoom(callId);
      this.logger.debug(`block force-ended friend call ${callId} between ${userA} and ${userB}`);
    } catch (err) {
      this.logger.debug(`endCallBetween(${userA},${userB}) failed: ${asMessage(err)}`);
    }
  }

  /**
   * Relay one cluster-wide presence transition to the sockets watching that user
   * (`presence:watch:<id>` rooms). Online-ish statuses map to `presence:online`
   * (carrying the precise status, e.g. `in_call`/`away`); `offline` maps to
   * `presence:offline`. The Redis adapter fans the emit out to every replica.
   *
   * Watchers are always OTHER users (a client never subscribes to its own id),
   * so a subject who disabled `showOnlineStatus` is masked to `offline` here —
   * their own session still sees their true state, since it never rides a watch
   * room. Best-effort: a settings-lookup failure relays the real transition.
   */
  private async relayPresence(payload: PresencePayload): Promise<void> {
    const masked = await this.maskHiddenPresence(payload);
    const room = this.server.to(presenceWatchRoom(masked.userId));
    if (masked.status === 'offline') {
      room.emit('presence:offline', masked);
    } else {
      room.emit('presence:online', masked);
    }
  }

  /**
   * Emit a single user's current presence to ONE socket (the `presence:subscribe`
   * reply). The subscriber is the OTHER user, so a subject who hides their online
   * status is masked to `offline`.
   */
  private emitPresenceTo(client: MmSocket, payload: PresencePayload): void {
    if (payload.status === 'offline') {
      client.emit('presence:offline', payload);
    } else {
      client.emit('presence:online', payload);
    }
  }

  /**
   * Coerce a presence transition/reply to `offline` when its subject disabled
   * `showOnlineStatus`, so the user appears offline to everyone watching them.
   * Already-offline payloads short-circuit (nothing to hide). On a settings read
   * failure we fail OPEN (return the real payload) rather than blackhole presence.
   */
  private async maskHiddenPresence(payload: PresencePayload): Promise<PresencePayload> {
    if (payload.status === 'offline') {
      return payload;
    }
    try {
      if (!(await this.settings.getShowOnlineStatus(payload.userId))) {
        return { userId: payload.userId, status: 'offline' };
      }
    } catch (err) {
      this.logger.debug(`showOnlineStatus lookup failed for ${payload.userId}: ${asMessage(err)}`);
    }
    return payload;
  }

  /**
   * Re-arm the presence connection-counter + status TTL for every user with a
   * live socket on THIS node (the per-node heartbeat). De-duplicated across a
   * user's devices so we touch each user once. Best-effort.
   *
   * Enumerates only THIS process's namespace socket map (`server.sockets`) — a
   * LOCAL, in-memory iteration with no Redis round-trip — rather than the
   * adapter's cluster-wide `fetchSockets()` (which fans an O(nodes × sockets)
   * request out over Redis every heartbeat). Each node refreshes exactly the
   * users it holds, which is precisely the per-node heartbeat's intent.
   */
  private async beatPresence(): Promise<void> {
    try {
      const userIds = new Set<string>();
      // This gateway runs under the `/mm` namespace, so the injected server is a
      // Namespace at runtime; its `.sockets` is the LOCAL `id → Socket` map for
      // this node (declared `AppIoServer`/Server here, narrowed to Namespace).
      const local = this.server as unknown as Namespace<
        ClientToServerEvents,
        ServerToClientEvents,
        InterServerEvents,
        SocketData
      >;
      for (const [, s] of local.sockets) {
        const uid = s.data.userId;
        if (uid) {
          userIds.add(uid);
        }
      }
      await Promise.all(
        Array.from(userIds, (uid) =>
          this.presence.refreshConnection(uid).catch((err: unknown) => {
            this.logger.debug(`presence heartbeat failed for ${uid}: ${asMessage(err)}`);
          }),
        ),
      );
    } catch (err) {
      this.logger.debug(`presence heartbeat sweep failed: ${asMessage(err)}`);
    }
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

/**
 * Best-effort client IP for the per-IP handshake throttle. Prefers the
 * left-most entry of `X-Forwarded-For` (the real client when behind nginx, which
 * sets it), mirroring `ThrottlerBehindProxyGuard`; falls back to the raw socket
 * address. Returns `undefined` when nothing usable is present (the limiter then
 * fails open — nginx is the edge defence in that case).
 */
function extractClientIp(client: MmSocket): string | undefined {
  const forwarded = client.handshake.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof raw === 'string') {
    const first = raw.split(',')[0]?.trim();
    if (first && first.length > 0) {
      return first;
    }
  }
  const address = client.handshake.address;
  return typeof address === 'string' && address.length > 0 ? address : undefined;
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

/**
 * Parse + validate a {@link BLOCK_ENFORCE_CHANNEL} message. The wire format is
 * JSON `{ userId, blockedUserId }`; both must be non-empty strings. Returns
 * `null` on any parse/shape failure so a malformed publish can never drive a
 * teardown.
 */
function parseBlockEnforceMessage(
  raw: string,
): { userId: string; blockedUserId: string } | null {
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
  const blockedUserId = (json as { blockedUserId?: unknown }).blockedUserId;
  if (
    typeof userId !== 'string' ||
    userId.length === 0 ||
    typeof blockedUserId !== 'string' ||
    blockedUserId.length === 0
  ) {
    return null;
  }
  return { userId, blockedUserId };
}

/** Narrows an unknown thrown value to a printable message. */
function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Lua: compare-and-delete. Delete KEYS[1] ONLY when its current value still
 * equals ARGV[1], returning the number deleted (1) — otherwise touch nothing and
 * return 0. Used so a stale call teardown only clears the active-call PAIR index
 * when it still points at THAT call's id, never clobbering a newer live call that
 * has since reused the (unordered) participant-pair key.
 */
const COMPARE_AND_DEL_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;
