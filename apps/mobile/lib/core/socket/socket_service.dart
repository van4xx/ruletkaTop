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
/// Design (mirrors the web client):
///  * Lazy + manual connect (`autoConnect: false`). Call [connect] after login
///    / on entering a realtime route.
///  * The JWT is presented via an auth FUNCTION read on EVERY (re)connect, so a
///    token refreshed while offline is picked up on the next attempt and a
///    stale token is never sent. The token comes from the in-memory
///    [TokenStore] (the same access token the REST bearer uses).
///  * Resilient reconnection (infinite attempts, capped exponential backoff
///    with jitter) for flaky mobile networks.
///
/// Typed helpers wrap raw `emit`/`on`; feature code never deals with the
/// untyped event bus directly. Every `on*` returns a [VoidCallback] that
/// removes the listener — keep it and call it in `dispose`.
class SocketService {
  SocketService(this._tokens);

  final TokenStore _tokens;

  io.Socket? _socket;

  final ValueNotifier<SocketStatus> status =
      ValueNotifier<SocketStatus>(SocketStatus.disconnected);

  /// Whether the underlying socket is currently connected.
  bool get isConnected => _socket?.connected ?? false;

  /// Lazily create the singleton socket (does not connect).
  io.Socket _ensure() {
    final existing = _socket;
    if (existing != null) return existing;

    final options = io.OptionBuilder()
        .setTransports(['websocket', 'polling'])
        .disableAutoConnect()
        .enableReconnection()
        .setReconnectionAttempts(double.infinity)
        .setReconnectionDelay(500)
        .setReconnectionDelayMax(5000)
        .setRandomizationFactor(0.5)
        .setTimeout(20000)
        // Re-read the live access token on every (re)handshake.
        .setAuthFn((cb) => cb({'token': _tokens.accessToken ?? ''}))
        .build();

    final socket = io.io(ApiConfig.wsUrl, options);
    _socket = socket;
    _bindLifecycle(socket);
    return socket;
  }

  void _bindLifecycle(io.Socket socket) {
    socket.onConnect((_) {
      status.value = SocketStatus.connected;
      if (kDebugMode) debugPrint('[socket] connected');
    });
    socket.onDisconnect((_) {
      status.value = SocketStatus.disconnected;
      if (kDebugMode) debugPrint('[socket] disconnected');
    });
    socket.onConnectError((err) {
      if (kDebugMode) debugPrint('[socket] connect_error: $err');
    });
    socket.onError((err) {
      if (kDebugMode) debugPrint('[socket] error: $err');
    });
    // Surface a server-side rejection (rate limit / ban / unauthorized).
    socket.on(SocketEvents.wsError, (data) {
      if (kDebugMode) debugPrint('[socket] ws:error: $data');
    });
  }

  /// Connect (or no-op if already connected). Requires an access token in the
  /// store; otherwise the gateway will reject the handshake.
  void connect() {
    final socket = _ensure();
    if (socket.connected) return;
    status.value = SocketStatus.connecting;
    socket.connect();
  }

  /// Force a clean re-handshake — call after a token refresh so the gateway
  /// re-authenticates with the new credentials.
  void reauthenticate() {
    final socket = _socket;
    if (socket == null) return;
    if (socket.connected) {
      socket.disconnect();
      socket.connect();
    }
  }

  /// Disconnect but keep the instance (re-usable on the next [connect]).
  void disconnect() {
    _socket?.disconnect();
    status.value = SocketStatus.disconnected;
  }

  /// Tear down completely (logout / app dispose).
  void dispose() {
    _socket?.dispose();
    _socket = null;
    status.value = SocketStatus.disconnected;
  }

  // ─────────────────────────── Raw helpers ────────────────────────────────
  void _emit(String event, [Object? data]) => _ensure().emit(event, data);

  /// Subscribe to [event], decoding each JSON-object payload with [decoder].
  /// Returns a disposer that removes the listener.
  VoidCallback _onJson<T>(String event, T Function(Map<String, dynamic>) decoder,
      void Function(T) onEvent) {
    void handler(dynamic data) {
      if (data is Map) {
        onEvent(decoder(Map<String, dynamic>.from(data)));
      }
    }

    final socket = _ensure();
    socket.on(event, handler);
    return () => socket.off(event, handler);
  }

  /// Subscribe to [event] with a raw (untyped) payload. Returns a disposer.
  VoidCallback _onRaw(String event, void Function(dynamic) onEvent) {
    final socket = _ensure();
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
  /// Send a chat message over the socket. Provide exactly one of
  /// [conversationId] / [recipientId].
  void chatMessage({String? conversationId, String? recipientId, required String content}) =>
      _emit(SocketEvents.chatMessage, {
        'conversationId': ?conversationId,
        'recipientId': ?recipientId,
        'content': content,
      });

  void chatTyping(String conversationId, bool isTyping) => _emit(
      SocketEvents.chatTyping,
      ChatTypingPayload(conversationId: conversationId, isTyping: isTyping).toJson());

  void chatRead(String conversationId, String messageId) => _emit(
      SocketEvents.chatRead,
      ChatReadPayload(conversationId: conversationId, messageId: messageId).toJson());

  VoidCallback onChatMessage(void Function(Message) cb) =>
      _onJson(SocketEvents.chatMessage, Message.fromJson, cb);

  VoidCallback onChatTyping(void Function(ChatTypingPayload) cb) =>
      _onJson(SocketEvents.chatTyping, ChatTypingPayload.fromJson, cb);

  VoidCallback onChatRead(void Function(ChatReadPayload) cb) =>
      _onJson(SocketEvents.chatRead, ChatReadPayload.fromJson, cb);

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
