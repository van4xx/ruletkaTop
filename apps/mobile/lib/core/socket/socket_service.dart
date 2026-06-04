import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../api/api.dart';
import '../models/models.dart';

/// Connection lifecycle of the realtime socket, surfaced for UI affordances
/// (e.g. a "reconnecting…" banner on roulette/chat screens).
enum SocketStatus { disconnected, connecting, connected }

/// Strongly-typed wrapper around `socket_io_client` for every ruletka.top
/// realtime feature (matchmaking, WebRTC signaling, presence, chat, direct
/// calls, notifications).
///
/// Design (mirrors the web client `apps/web/src/lib/socket.ts`):
///  * The backend exposes its realtime layer over TWO Socket.IO NAMESPACES,
///    each a separate connection (one engine.io transport per namespace):
///      - `/mm`   — matchmaking/roulette (`mm:*`, `rtc:*`), presence
///        (`presence:*`), direct calls (`call:*`), notification delivery
///        (`notif:new`). This is the primary socket.
///      - `/chat` — direct messaging (`chat:*`).
///    There is NO default-namespace gateway, so a socket opened on the bare
///    origin (no path) would connect to `/` and hear nothing. We therefore open
///    one socket per namespace and route each typed helper to the right one.
///  * Lazy + manual connect (`autoConnect: false`). Call [connect] after login
///    / on entering a realtime route; it brings BOTH namespaces online.
///  * The JWT is presented via an auth FUNCTION read on EVERY (re)connect, so a
///    token refreshed while offline is picked up on the next attempt and a
///    stale token is never sent. The token comes from the in-memory
///    [TokenStore] (the same access token the REST bearer uses), sent as
///    `handshake.auth.token` — exactly what both NestJS gateways read.
///  * Resilient reconnection (infinite attempts, capped exponential backoff
///    with jitter) for flaky mobile networks.
///
/// Both namespaces multiplex over a single underlying engine.io Manager (the
/// `socket_io_client` cache keys the Manager by scheme/host/port and opens one
/// namespace socket per URL path), so this is one transport, two logical
/// channels — just like the web client.
///
/// Typed helpers wrap raw `emit`/`on`; feature code never deals with the
/// untyped event bus directly. Every `on*` returns a [VoidCallback] that
/// removes the listener — keep it and call it in `dispose`.
class SocketService {
  SocketService(this._tokens);

  final TokenStore _tokens;

  /// Primary namespace: matchmaking, WebRTC signaling, presence, calls,
  /// notifications. Also the one whose connection state drives [status].
  static const String _mmNamespace = '/mm';

  /// Direct-messaging namespace.
  static const String _chatNamespace = '/chat';

  io.Socket? _mm;
  io.Socket? _chat;

  final ValueNotifier<SocketStatus> status =
      ValueNotifier<SocketStatus>(SocketStatus.disconnected);

  /// Whether the primary (`/mm`) socket is currently connected. Matchmaking,
  /// presence, calls and notifications all ride on it.
  bool get isConnected => _mm?.connected ?? false;

  /// Build the shared option set (identical for both namespaces).
  io.OptionBuilder _options() => io.OptionBuilder()
      .setTransports(['websocket', 'polling'])
      .disableAutoConnect()
      .enableReconnection()
      .setReconnectionAttempts(double.infinity)
      .setReconnectionDelay(500)
      .setReconnectionDelayMax(5000)
      .setRandomizationFactor(0.5)
      .setTimeout(20000)
      // Re-read the live access token on every (re)handshake, sent as
      // `handshake.auth.token` (what WsAuthService verifies server-side).
      .setAuthFn((cb) => cb({'token': _tokens.accessToken ?? ''}));

  /// Lazily create the singleton `/mm` socket (does not connect).
  io.Socket _ensureMm() {
    final existing = _mm;
    if (existing != null) return existing;
    // The namespace is the URL PATH: `<origin>/mm` connects to `/mm`.
    final socket = io.io('${ApiConfig.wsUrl}$_mmNamespace', _options().build());
    _mm = socket;
    _bindLifecycle(socket, _mmNamespace, primary: true);
    return socket;
  }

  /// Lazily create the singleton `/chat` socket (does not connect).
  io.Socket _ensureChat() {
    final existing = _chat;
    if (existing != null) return existing;
    final socket =
        io.io('${ApiConfig.wsUrl}$_chatNamespace', _options().build());
    _chat = socket;
    _bindLifecycle(socket, _chatNamespace, primary: false);
    return socket;
  }

  /// Drive [status] off the PRIMARY (`/mm`) socket only, so a UI "reconnecting…"
  /// banner reflects the matchmaking transport. The `/chat` socket reconnects on
  /// the same schedule and is best-effort for messaging.
  void _bindLifecycle(io.Socket socket, String namespace,
      {required bool primary}) {
    socket.onConnect((_) {
      if (primary) status.value = SocketStatus.connected;
      if (kDebugMode) debugPrint('[socket$namespace] connected');
    });
    socket.onDisconnect((_) {
      if (primary) status.value = SocketStatus.disconnected;
      if (kDebugMode) debugPrint('[socket$namespace] disconnected');
    });
    socket.onConnectError((err) {
      if (kDebugMode) debugPrint('[socket$namespace] connect_error: $err');
    });
    socket.onError((err) {
      if (kDebugMode) debugPrint('[socket$namespace] error: $err');
    });
    // Surface a server-side rejection (rate limit / ban / unauthorized).
    socket.on(SocketEvents.wsError, (data) {
      if (kDebugMode) debugPrint('[socket$namespace] ws:error: $data');
    });
  }

  /// Connect BOTH namespaces (or no-op for one that's already connected).
  /// Requires an access token in the store; otherwise the gateways reject the
  /// handshake.
  void connect() {
    final mm = _ensureMm();
    final chat = _ensureChat();
    if (!mm.connected || !chat.connected) {
      status.value = SocketStatus.connecting;
    }
    if (!mm.connected) mm.connect();
    if (!chat.connected) chat.connect();
  }

  /// Force a clean re-handshake on BOTH namespaces — call after a token refresh
  /// so the gateways re-authenticate with the new credentials.
  void reauthenticate() {
    for (final socket in [_mm, _chat]) {
      if (socket != null && socket.connected) {
        socket.disconnect();
        socket.connect();
      }
    }
  }

  /// Disconnect both sockets but keep the instances (re-usable on next
  /// [connect]).
  void disconnect() {
    _mm?.disconnect();
    _chat?.disconnect();
    status.value = SocketStatus.disconnected;
  }

  /// Tear down completely (logout / app dispose).
  void dispose() {
    _mm?.dispose();
    _chat?.dispose();
    _mm = null;
    _chat = null;
    status.value = SocketStatus.disconnected;
  }

  // ─────────────────────────── Raw helpers ────────────────────────────────
  /// Emit [event] on the primary `/mm` socket.
  void _emit(String event, [Object? data]) => _ensureMm().emit(event, data);

  /// Emit [event] on the `/chat` socket.
  void _emitChat(String event, [Object? data]) =>
      _ensureChat().emit(event, data);

  /// Subscribe to [event] on [socket], decoding each JSON-object payload with
  /// [decoder]. Returns a disposer that removes the listener.
  VoidCallback _onJsonOn<T>(io.Socket socket, String event,
      T Function(Map<String, dynamic>) decoder, void Function(T) onEvent) {
    void handler(dynamic data) {
      if (data is Map) {
        onEvent(decoder(Map<String, dynamic>.from(data)));
      }
    }

    socket.on(event, handler);
    return () => socket.off(event, handler);
  }

  /// Subscribe to a JSON [event] on the primary `/mm` socket.
  VoidCallback _onJson<T>(String event, T Function(Map<String, dynamic>) decoder,
          void Function(T) onEvent) =>
      _onJsonOn(_ensureMm(), event, decoder, onEvent);

  /// Subscribe to a JSON [event] on the `/chat` socket.
  VoidCallback _onJsonChat<T>(String event,
          T Function(Map<String, dynamic>) decoder, void Function(T) onEvent) =>
      _onJsonOn(_ensureChat(), event, decoder, onEvent);

  /// Subscribe to [event] (raw, untyped) on the primary `/mm` socket. Returns a
  /// disposer.
  VoidCallback _onRaw(String event, void Function(dynamic) onEvent) {
    final socket = _ensureMm();
    socket.on(event, onEvent);
    return () => socket.off(event, onEvent);
  }

  // ───────────────────────────── Matchmaking ──────────────────────────────
  /// Join the matchmaking queue for [type] with [filters].
  void mmJoin(MatchType type, MatchFilters filters) =>
      _emit(SocketEvents.mmJoin, MmJoinPayload(type: type, filters: filters).toJson());

  /// Leave the queue / end the current session.
  void mmLeave() => _emit(SocketEvents.mmLeave);

  /// Skip to the next partner.
  void mmNext() => _emit(SocketEvents.mmNext);

  VoidCallback onMatched(void Function(MmMatchedPayload) cb) =>
      _onJson(SocketEvents.mmMatched, MmMatchedPayload.fromJson, cb);

  VoidCallback onWaiting(void Function(MmWaitingPayload) cb) =>
      _onJson(SocketEvents.mmWaiting, MmWaitingPayload.fromJson, cb);

  // ──────────────────────────── WebRTC signaling ──────────────────────────
  void rtcOffer(String roomId, String sdp) =>
      _emit(SocketEvents.rtcOffer, RtcSdpPayload(roomId: roomId, sdp: sdp).toJson());

  void rtcAnswer(String roomId, String sdp) =>
      _emit(SocketEvents.rtcAnswer, RtcSdpPayload(roomId: roomId, sdp: sdp).toJson());

  void rtcIce(String roomId, Object? candidate) =>
      _emit(SocketEvents.rtcIce, RtcIcePayload(roomId: roomId, candidate: candidate).toJson());

  void rtcHangup(String roomId, {MatchEndReason reason = MatchEndReason.stop}) =>
      _emit(SocketEvents.rtcHangup, RtcHangupPayload(roomId: roomId, reason: reason).toJson());

  VoidCallback onRtcOffer(void Function(RtcSdpPayload) cb) =>
      _onJson(SocketEvents.rtcOffer, RtcSdpPayload.fromJson, cb);

  VoidCallback onRtcAnswer(void Function(RtcSdpPayload) cb) =>
      _onJson(SocketEvents.rtcAnswer, RtcSdpPayload.fromJson, cb);

  VoidCallback onRtcIce(void Function(RtcIcePayload) cb) =>
      _onJson(SocketEvents.rtcIce, RtcIcePayload.fromJson, cb);

  VoidCallback onRtcHangup(void Function(RtcHangupPayload) cb) =>
      _onJson(SocketEvents.rtcHangup, RtcHangupPayload.fromJson, cb);

  // ────────────────────────────── Presence ────────────────────────────────
  /// Subscribe to presence updates for a set of user ids.
  void presenceSubscribe(List<String> userIds) =>
      _emit(SocketEvents.presenceSubscribe, userIds);

  VoidCallback onPresenceOnline(void Function(PresencePayload) cb) =>
      _onJson(SocketEvents.presenceOnline, PresencePayload.fromJson, cb);

  VoidCallback onPresenceOffline(void Function(PresencePayload) cb) =>
      _onJson(SocketEvents.presenceOffline, PresencePayload.fromJson, cb);

  // ─────────────────────────────── Chat ───────────────────────────────────
  // Chat rides on the SEPARATE `/chat` namespace (the `ChatGateway`), so these
  // helpers emit/listen on `_chat`, not the primary `/mm` socket.
  /// Send a chat message over the socket. Provide exactly one of
  /// [conversationId] / [recipientId].
  void chatMessage({String? conversationId, String? recipientId, required String content}) =>
      _emitChat(SocketEvents.chatMessage, {
        'conversationId': ?conversationId,
        'recipientId': ?recipientId,
        'content': content,
      });

  void chatTyping(String conversationId, bool isTyping) => _emitChat(
      SocketEvents.chatTyping,
      ChatTypingPayload(conversationId: conversationId, isTyping: isTyping).toJson());

  void chatRead(String conversationId, String messageId) => _emitChat(
      SocketEvents.chatRead,
      ChatReadPayload(conversationId: conversationId, messageId: messageId).toJson());

  VoidCallback onChatMessage(void Function(Message) cb) =>
      _onJsonChat(SocketEvents.chatMessage, Message.fromJson, cb);

  VoidCallback onChatTyping(void Function(ChatTypingPayload) cb) =>
      _onJsonChat(SocketEvents.chatTyping, ChatTypingPayload.fromJson, cb);

  VoidCallback onChatRead(void Function(ChatReadPayload) cb) =>
      _onJsonChat(SocketEvents.chatRead, ChatReadPayload.fromJson, cb);

  // ─────────────────────────── Direct calls ───────────────────────────────
  void callInvite(String toUserId, MatchType type) => _emit(
      SocketEvents.callInvite, CallInvitePayload(toUserId: toUserId, type: type).toJson());

  void callAccept(String callId) =>
      _emit(SocketEvents.callAccept, CallResponsePayload(callId: callId).toJson());

  void callDecline(String callId) =>
      _emit(SocketEvents.callDecline, CallResponsePayload(callId: callId).toJson());

  void callEnd(String callId) =>
      _emit(SocketEvents.callEnd, CallResponsePayload(callId: callId).toJson());

  VoidCallback onIncomingCall(void Function(IncomingCall) cb) =>
      _onJson(SocketEvents.callInvite, IncomingCall.fromJson, cb);

  VoidCallback onCallAccept(void Function(CallResponsePayload) cb) =>
      _onJson(SocketEvents.callAccept, CallResponsePayload.fromJson, cb);

  VoidCallback onCallDecline(void Function(CallResponsePayload) cb) =>
      _onJson(SocketEvents.callDecline, CallResponsePayload.fromJson, cb);

  VoidCallback onCallEnd(void Function(CallResponsePayload) cb) =>
      _onJson(SocketEvents.callEnd, CallResponsePayload.fromJson, cb);

  // ──────────────────────────── Notifications ─────────────────────────────
  VoidCallback onNotification(void Function(AppNotification) cb) =>
      _onJson(SocketEvents.notifNew, AppNotification.fromJson, cb);

  /// Server→client error (rate limit / ban / forced disconnect).
  VoidCallback onWsError(void Function(WsErrorPayload) cb) =>
      _onJson(SocketEvents.wsError, WsErrorPayload.fromJson, cb);

  // ───────────────────────── Escape hatches ───────────────────────────────
  /// Emit a raw event (for any future event not yet wrapped above).
  void emitRaw(String event, [Object? data]) => _emit(event, data);

  /// Listen to a raw event. Returns a disposer.
  VoidCallback onRaw(String event, void Function(dynamic) cb) => _onRaw(event, cb);
}
