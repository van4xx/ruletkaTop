import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../../../core/models/models.dart';
import '../data/webrtc_service.dart';

/// The roulette session phase — mirrors the web `RouletteStatus` union.
enum RouletteStatus {
  /// Pre-flight: nothing running, awaiting the first Start.
  idle,

  /// Acquiring local media / permissions.
  requesting,

  /// In the matchmaking queue, waiting for a peer.
  searching,

  /// Matched; negotiating the peer connection (offer/answer/ICE).
  connecting,

  /// Media is flowing — a live call.
  connected,

  /// The peer left; brief interstitial before auto-requeue.
  ended,

  /// A recoverable error (permission / device / network / auth).
  error,
}

/// A recoverable roulette error, tagged with a coarse [kind] the UI maps to an
/// icon + copy. Mirrors the web `RouletteError`.
class RouletteError {
  const RouletteError({required this.kind, required this.message});

  /// One of: denied, permanentlyDenied, notfound, inuse, insecure, socket,
  /// timeout, auth, unknown.
  final String kind;
  final String message;

  factory RouletteError.fromMedia(MediaException e) =>
      RouletteError(kind: e.kind.name, message: e.message);
}

/// A single in-call chat line (peer-to-peer over the data channel).
class ChatLine {
  const ChatLine({required this.id, required this.fromMe, required this.text, required this.at});

  final String id;
  final bool fromMe;
  final String text;
  final DateTime at;
}

/// The full, immutable roulette session state — the single source of truth the
/// video/voice screens render. Mirrors the web `RouletteState` reducer.
class RouletteState {
  const RouletteState({
    this.status = RouletteStatus.idle,
    this.roomId,
    this.peer,
    this.localStream,
    this.remoteStream,
    this.socketConnected = false,
    this.micMuted = false,
    this.cameraOff = false,
    this.positionHint,
    this.error,
    this.filters = const MatchFilters(),
    this.chatMessages = const [],
    this.chatOpen = false,
    this.isStarting = false,
    this.quality = ConnectionQuality.unknown,
    this.reconnecting = false,
    this.flagged = false,
  });

  final RouletteStatus status;
  final String? roomId;
  final PeerInfo? peer;

  /// Live media streams (not value-compared; identity is what matters for
  /// renderer attachment).
  final MediaStream? localStream;
  final MediaStream? remoteStream;

  final bool socketConnected;
  final bool micMuted;
  final bool cameraOff;

  /// Queue position hint surfaced by `mm:waiting` (when the server provides it).
  final int? positionHint;

  final RouletteError? error;
  final MatchFilters filters;
  final List<ChatLine> chatMessages;
  final bool chatOpen;

  /// True while [start] is acquiring media (drives the Start button spinner).
  final bool isStarting;

  /// Live connection-quality bucket from `getStats()` polling. [unknown] hides
  /// the indicator (no usable sample yet, or stats unavailable on this device).
  final ConnectionQuality quality;

  /// The media transport dropped and we are actively trying to recover it
  /// (grace timer running or an ICE restart in flight). Status stays
  /// [RouletteStatus.connected] so the call UI is preserved; this just drives a
  /// "reconnecting…" treatment over the live call.
  final bool reconnecting;

  /// On-device NSFW screening tripped on the LOCAL camera: the local preview is
  /// blurred/cut and the outbound video track is disabled until it self-heals.
  /// Mirrors the web's `screening.flagged`.
  final bool flagged;

  /// A peer is matched and we are connecting or connected.
  bool get hasPeer =>
      peer != null && (status == RouletteStatus.connecting || status == RouletteStatus.connected);

  /// The media stage (remote video / voice visualizer) should be mounted.
  bool get showStage =>
      status == RouletteStatus.connecting || status == RouletteStatus.connected;

  /// The session is active (between start and stop).
  bool get isActive => status != RouletteStatus.idle && status != RouletteStatus.error;

  RouletteState copyWith({
    RouletteStatus? status,
    String? roomId,
    bool clearRoomId = false,
    PeerInfo? peer,
    bool clearPeer = false,
    MediaStream? localStream,
    bool clearLocalStream = false,
    MediaStream? remoteStream,
    bool clearRemoteStream = false,
    bool? socketConnected,
    bool? micMuted,
    bool? cameraOff,
    int? positionHint,
    bool clearPositionHint = false,
    RouletteError? error,
    bool clearError = false,
    MatchFilters? filters,
    List<ChatLine>? chatMessages,
    bool? chatOpen,
    bool? isStarting,
    ConnectionQuality? quality,
    bool? reconnecting,
    bool? flagged,
  }) {
    return RouletteState(
      status: status ?? this.status,
      roomId: clearRoomId ? null : (roomId ?? this.roomId),
      peer: clearPeer ? null : (peer ?? this.peer),
      localStream: clearLocalStream ? null : (localStream ?? this.localStream),
      remoteStream: clearRemoteStream ? null : (remoteStream ?? this.remoteStream),
      socketConnected: socketConnected ?? this.socketConnected,
      micMuted: micMuted ?? this.micMuted,
      cameraOff: cameraOff ?? this.cameraOff,
      positionHint: clearPositionHint ? null : (positionHint ?? this.positionHint),
      error: clearError ? null : (error ?? this.error),
      filters: filters ?? this.filters,
      chatMessages: chatMessages ?? this.chatMessages,
      chatOpen: chatOpen ?? this.chatOpen,
      isStarting: isStarting ?? this.isStarting,
      quality: quality ?? this.quality,
      reconnecting: reconnecting ?? this.reconnecting,
      flagged: flagged ?? this.flagged,
    );
  }
}
