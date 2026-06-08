import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../../../core/api/api.dart';
import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../../../core/socket/socket.dart';
import '../data/local_screening.dart';
import '../data/media_permissions.dart';
import '../data/turn_repository.dart';
import '../data/webrtc_service.dart';
import '../domain/roulette_state.dart';

/// How long we wait for a match before surfacing a soft "long wait" hint.
const Duration _kMatchTimeout = Duration(seconds: 30);

/// Auto-requeue delay after a peer hangs up (so the user reads "отключился").
const Duration _kRequeueDelay = Duration(milliseconds: 1200);

/// Grace period after the ICE transport goes `disconnected` before we treat it
/// as a hard failure and attempt recovery. A brief blip (network handoff, lock
/// screen) often heals itself within this window with no user-visible churn.
const Duration _kIceDisconnectGrace = Duration(seconds: 3);

/// How often we poll `getStats()` for the live connection-quality indicator.
const Duration _kStatsInterval = Duration(seconds: 2);

/// Max ICE-restart attempts before we give up and re-queue for a fresh peer.
const int _kMaxIceRestarts = 2;

/// Backstop: if an ICE restart doesn't reconnect within this window, try again
/// (up to [_kMaxIceRestarts]) or fall back to re-queueing.
const Duration _kIceRestartTimeout = Duration(seconds: 8);

/// The orchestration engine behind /video and /voice — the Dart port of the
/// web's `useRoulette` hook.
///
/// Owns the full session lifecycle and bridges three subsystems:
///   1. Matchmaking signaling over the typed [SocketService] (`mm:*`, `rtc:*`).
///   2. Local media (`getUserMedia`) lifecycle.
///   3. A per-match [PeerConnectionManager] (SDP + ICE).
///
/// Flow:
///   start() → permissions → getUserMedia → fetch ICE → socket.connect →
///             emit `mm:join {type, filters}` → status searching
///   ← `mm:waiting`  → keep searching (+ optional position hint)
///   ← `mm:matched {roomId, peer, isInitiator}`
///        build PeerConnectionManager(iceServers), add local tracks,
///        isInitiator: createOffer → `rtc:offer`; else wait for offer → answer
///   ⇄ `rtc:ice-candidate` both directions (queued until remoteDescription set)
///   ← `rtc:hangup` / disconnect → status ended → auto-requeue
///   next()  → `rtc:hangup` + `mm:next` + close peer (server re-queues)
///   stop()  → `mm:leave` + close peer + stop tracks + disconnect
///
/// Everything is torn down deterministically on stop()/next()/dispose.
class RouletteController extends Notifier<RouletteState> {
  /// Riverpod 3.x family notifiers receive their family key via the constructor
  /// (the provider factory is `RouletteController Function(MatchType)`).
  RouletteController(this._type);

  final MatchType _type;
  bool get _isVideo => _type == MatchType.video;

  // Live, non-render objects.
  MediaStream? _localStream;
  PeerConnectionManager? _peer;
  String? _roomId;
  List<IceServerConfig>? _iceServers;

  /// Whether *we* are the offerer for the current match — only the initiator
  /// drives ICE restarts (the answerer responds to the relayed offer).
  bool _isInitiator = false;

  /// Session active between start() and stop().
  bool _started = false;

  Timer? _matchTimer;
  Timer? _requeueTimer;

  // ── Reconnection / quality machinery (per match) ──
  /// Armed when ICE goes `disconnected`; promotes to a recovery attempt if the
  /// transport doesn't heal within [_kIceDisconnectGrace].
  Timer? _iceGraceTimer;

  /// Backstop for an in-flight ICE restart that never reconnects.
  Timer? _iceRestartTimer;

  /// Periodic `getStats()` poll driving the quality indicator.
  Timer? _statsTimer;

  /// How many ICE restarts we've attempted for the *current* match.
  int _iceRestartAttempts = 0;

  // Socket listener disposers (set up once on first start, cleared on dispose).
  final List<VoidCallback> _subs = [];
  bool _wired = false;

  /// Last observed socket status, to detect connected→disconnected edges.
  SocketStatus _lastSocketStatus = SocketStatus.disconnected;

  /// On-device NSFW screening of the LOCAL camera (video calls only). Drives
  /// [RouletteState.flagged]; gated to a no-op classifier by default (see
  /// `local_screening.dart` + `nsfw_classifier.dart`).
  LocalScreeningController? _screening;

  /// True when the local feed is currently cut by screening AND we disabled the
  /// outbound video track, so we know to re-enable it on un-flag (unless the
  /// user separately turned their camera off).
  bool _videoCutByScreening = false;

  /// Host hook for server-forced moderation actions (`mod:action`). The screen
  /// sets this to surface the warn/kick/ban UX; the controller still performs
  /// the teardown (kick/ban end the call) regardless of whether it's set.
  void Function(ModerationActionPayload payload)? onModeration;

  SocketService get _socket => ref.read(socketServiceProvider);
  TurnRepository get _turn => TurnRepository(ref.read(apiClientProvider));

  @override
  RouletteState build() {
    // Teardown when the provider is disposed (screen popped / app shutdown):
    // never leak a camera light or a socket room.
    ref.onDispose(_disposeAll);
    return const RouletteState();
  }

  // ──────────────────────────── Timer helpers ─────────────────────────────
  void _clearMatchTimer() {
    _matchTimer?.cancel();
    _matchTimer = null;
  }

  void _clearRequeueTimer() {
    _requeueTimer?.cancel();
    _requeueTimer = null;
  }

  void _clearIceGraceTimer() {
    _iceGraceTimer?.cancel();
    _iceGraceTimer = null;
  }

  void _clearIceRestartTimer() {
    _iceRestartTimer?.cancel();
    _iceRestartTimer = null;
  }

  void _stopStatsPolling() {
    _statsTimer?.cancel();
    _statsTimer = null;
  }

  /// Tear down all per-match reconnection + quality state. Called whenever a
  /// match ends (peer gone / next / stop) so timers never outlive their peer.
  void _resetCallHealth() {
    _clearIceGraceTimer();
    _clearIceRestartTimer();
    _stopStatsPolling();
    _iceRestartAttempts = 0;
  }

  /// Arm the soft match timeout: stay searching, but drop any position hint so
  /// the UI can show the "tweak your filters" nudge.
  void _armMatchTimeout() {
    _clearMatchTimer();
    _matchTimer = Timer(_kMatchTimeout, () {
      if (!_started) return;
      if (state.status == RouletteStatus.searching) {
        state = state.copyWith(clearPositionHint: true);
      }
    });
  }

  // ───────────────────────── Socket event wiring ──────────────────────────
  void _wireSocket() {
    if (_wired) return;
    _wired = true;

    _subs.add(_socket.onWaiting(_onWaiting));
    _subs.add(_socket.onMatched(_onMatched));
    _subs.add(_socket.onRtcOffer(_onOffer));
    _subs.add(_socket.onRtcAnswer(_onAnswer));
    _subs.add(_socket.onRtcIce(_onIce));
    _subs.add(_socket.onRtcHangup((_) => _handlePeerGone()));
    // Server-forced moderation (warn / kick / ban) for THIS session.
    _subs.add(_socket.onModAction(_onModeration));

    // Drive (re)connect / disconnect off the service's status notifier (the
    // foundation exposes connection lifecycle this way, not as raw socket
    // callbacks). The queue join is driven off connect: emit `mm:join`
    // whenever an active session has no live match — covers the initial join
    // AND recovers our slot after a reconnect that dropped the queue entry.
    _lastSocketStatus = _socket.status.value;
    void onStatus() => _onSocketStatus(_socket.status.value);
    _socket.status.addListener(onStatus);
    _subs.add(() => _socket.status.removeListener(onStatus));
  }

  void _onSocketStatus(SocketStatus next) {
    final prev = _lastSocketStatus;
    _lastSocketStatus = next;
    final connected = next == SocketStatus.connected;
    state = state.copyWith(socketConnected: connected);

    if (connected) {
      if (_started && _peer == null && _roomId == null) _emitJoin();
    } else if (prev == SocketStatus.connected) {
      // A mid-call disconnect ends the current match; the socket auto-reconnects
      // and the reconnect (peer == null) requeues.
      if (_started && _peer != null) _handlePeerGone();
    }
  }

  /// Handle a server-forced `mod:action` on the current session (mirrors the
  /// web `useModerationAction`):
  ///   warn → advisory; the call continues (host shows a warning toast).
  ///   kick → end the current call + return to idle (host shows a toast).
  ///   ban  → end the call; host shows a blocking acknowledgement that signs the
  ///          user out (their session is now invalid server-side).
  /// blur/none are advisory (the local screening loop already cut the preview),
  /// so they only surface a host toast.
  ///
  /// The teardown is performed HERE so the call always ends on kick/ban even if
  /// no host UX is attached; the host hook handles the user-facing messaging.
  void _onModeration(ModerationActionPayload payload) {
    switch (payload.action) {
      case ModerationAction.kick:
      case ModerationAction.ban:
        // Tear the call down immediately; the host hook drives the toast/modal
        // (and, for a ban, the sign-out).
        unawaited(stop());
        break;
      case ModerationAction.warn:
      case ModerationAction.blur:
      case ModerationAction.none:
        break;
    }
    onModeration?.call(payload);
  }

  void _emitJoin() {
    _socket.mmJoin(_type, state.filters);
    state = state.copyWith(
      status: RouletteStatus.searching,
      clearRoomId: true,
      clearPeer: true,
      clearRemoteStream: true,
      clearPositionHint: true,
      chatMessages: const [],
      chatOpen: false,
      quality: ConnectionQuality.unknown,
      reconnecting: false,
    );
    _armMatchTimeout();
  }

  void _onWaiting(MmWaitingPayload p) {
    _armMatchTimeout();
    state = state.copyWith(
      status: RouletteStatus.searching,
      positionHint: p.positionHint,
    );
  }

  Future<void> _onMatched(MmMatchedPayload p) async {
    if (!_started) return;
    _clearRequeueTimer();
    _clearMatchTimer();
    // Fresh match → wipe the previous call's reconnect/quality machinery.
    _resetCallHealth();

    _roomId = p.roomId;
    state = state.copyWith(
      status: RouletteStatus.connecting,
      roomId: p.roomId,
      peer: p.peer,
      clearRemoteStream: true,
      chatMessages: const [],
      chatOpen: false,
      quality: ConnectionQuality.unknown,
      reconnecting: false,
    );

    // Negotiation timeout: if media never connects, skip this match cleanly
    // (server-side teardown + re-queue) rather than leaving a half-open room.
    // Skip the bail-out while a recovery (ICE restart) is in flight — that path
    // has its own backstop and may still heal the existing connection.
    _matchTimer = Timer(_kMatchTimeout, () {
      final connected =
          _peer?.connectionState == RTCPeerConnectionState.RTCPeerConnectionStateConnected;
      if (_peer != null && !connected && !state.reconnecting) next();
    });

    await _beginNegotiation(p);
  }

  Future<void> _beginNegotiation(MmMatchedPayload matched) async {
    if (!_started) return; // stale match for a closed session
    final iceServers = _iceServers ?? kFallbackIceServers;
    _isInitiator = matched.isInitiator;

    final manager = PeerConnectionManager(
      iceServers,
      PeerManagerCallbacks(
        onIceCandidate: (candidate) {
          final room = _roomId;
          if (room != null) _socket.rtcIce(room, candidate.toMap());
        },
        onRemoteStream: (stream) {
          if (!_started) return;
          state = state.copyWith(remoteStream: stream);
        },
        onConnectionState: (connState) {
          if (connState == RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
            _onCallLive();
          } else if (connState == RTCPeerConnectionState.RTCPeerConnectionStateFailed) {
            // A hard aggregate failure: try to recover in place before giving up.
            _onTransportTrouble(failed: true);
          } else if (connState == RTCPeerConnectionState.RTCPeerConnectionStateClosed) {
            _handlePeerGone();
          } else if (connState == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) {
            _onTransportTrouble(failed: false);
          }
        },
        onIceConnectionState: (iceState) {
          switch (iceState) {
            case RTCIceConnectionState.RTCIceConnectionStateConnected:
            case RTCIceConnectionState.RTCIceConnectionStateCompleted:
              _onCallLive();
              break;
            case RTCIceConnectionState.RTCIceConnectionStateFailed:
              _onTransportTrouble(failed: true);
              break;
            case RTCIceConnectionState.RTCIceConnectionStateDisconnected:
              _onTransportTrouble(failed: false);
              break;
            case RTCIceConnectionState.RTCIceConnectionStateClosed:
              _handlePeerGone();
              break;
            default:
              break;
          }
        },
        onDataMessage: (text) => _addChatLine(fromMe: false, text: text),
      ),
    );
    _peer = manager;

    await manager.init(isInitiator: matched.isInitiator, withChat: true);

    final local = _localStream;
    if (local != null) await manager.addLocalStream(local);

    if (matched.isInitiator) {
      final sdp = await manager.createOffer();
      final room = _roomId;
      if (room != null && _started) _socket.rtcOffer(room, sdp);
    }
    // Non-initiator waits for `rtc:offer` (handled in [_onOffer]).

    // Begin on-device local-camera screening for this (video) match.
    _syncScreening();
  }

  // ───────────────────── Reconnection + quality engine ────────────────────

  /// The transport is (re)established. Promote to `connected`, clear any
  /// reconnecting treatment + recovery timers, and (re)start quality polling.
  /// Idempotent: fires from both `onConnectionState` and `onIceConnectionState`
  /// and on every successful ICE restart.
  void _onCallLive() {
    if (!_started || _peer == null) return;
    _clearMatchTimer();
    _clearIceGraceTimer();
    _clearIceRestartTimer();
    _iceRestartAttempts = 0;
    if (state.status != RouletteStatus.connected || state.reconnecting) {
      state = state.copyWith(status: RouletteStatus.connected, reconnecting: false);
    }
    _startStatsPolling();
  }

  /// The transport dropped. `disconnected` arms a short grace timer (most blips
  /// self-heal); `failed` recovers immediately. Surfaces a "reconnecting"
  /// treatment over the still-mounted call rather than tearing it down.
  void _onTransportTrouble({required bool failed}) {
    if (!_started || _peer == null) return;
    // Already connected UI → flip to reconnecting (keep the call mounted).
    if (!state.reconnecting) {
      state = state.copyWith(reconnecting: true, quality: ConnectionQuality.poor);
    }

    if (failed) {
      _clearIceGraceTimer();
      _attemptRecovery();
    } else {
      // Soft drop: give it a beat to recover on its own before forcing a restart.
      if (_iceGraceTimer != null) return; // grace already running
      _iceGraceTimer = Timer(_kIceDisconnectGrace, () {
        _iceGraceTimer = null;
        if (!_started || _peer == null) return;
        final live = _peer?.connectionState ==
            RTCPeerConnectionState.RTCPeerConnectionStateConnected;
        if (!live) _attemptRecovery();
      });
    }
  }

  /// Try to heal the current connection in place via an ICE restart. Only the
  /// initiator drives this (it owns the renegotiation offer); the answerer
  /// simply waits for the relayed restart offer and answers it. After
  /// [_kMaxIceRestarts] failed attempts we give up and re-queue for a new peer.
  Future<void> _attemptRecovery() async {
    if (!_started) return;
    final manager = _peer;
    final room = _roomId;
    if (manager == null || room == null) return;

    if (_iceRestartAttempts >= _kMaxIceRestarts) {
      // Out of in-place retries → drop the peer and find a fresh one.
      _handlePeerGone();
      return;
    }

    // The answerer can't initiate a renegotiation; it relies on the initiator's
    // restart offer arriving over `rtc:offer`. Keep showing "reconnecting" and
    // let the grace/restart backstop or a hangup decide the outcome.
    if (!_isInitiator) {
      _armIceRestartBackstop();
      return;
    }

    _iceRestartAttempts++;
    if (!state.reconnecting) state = state.copyWith(reconnecting: true);

    final sdp = await manager.createIceRestartOffer();
    if (!_started || _peer != manager) return; // torn down mid-await
    if (sdp == null) {
      // Restart unsupported / failed on this device → fall back to re-queue.
      _handlePeerGone();
      return;
    }
    _socket.rtcOffer(room, sdp);
    _armIceRestartBackstop();
  }

  /// Arm a one-shot backstop: if the restart hasn't reconnected within
  /// [_kIceRestartTimeout], try again (or re-queue once retries are exhausted).
  void _armIceRestartBackstop() {
    _clearIceRestartTimer();
    _iceRestartTimer = Timer(_kIceRestartTimeout, () {
      _iceRestartTimer = null;
      if (!_started || _peer == null) return;
      final live = _peer?.connectionState ==
          RTCPeerConnectionState.RTCPeerConnectionStateConnected;
      if (live) return;
      if (_iceRestartAttempts >= _kMaxIceRestarts) {
        _handlePeerGone();
      } else {
        _attemptRecovery();
      }
    });
  }

  /// Begin the ~2s `getStats()` poll feeding the quality badge. Idempotent: a
  /// no-op if already polling, so redundant `connected` events (we get one from
  /// both the aggregate and ICE state callbacks) don't reset the cadence.
  /// Defensive: a failed/empty sample keeps the previous bucket; while we're
  /// reconnecting we don't let a stale sample paint over the "poor" state.
  void _startStatsPolling() {
    if (_statsTimer != null) return;
    // Kick an immediate sample so the badge appears promptly, then poll.
    unawaited(_sampleStats());
    _statsTimer = Timer.periodic(_kStatsInterval, (_) => _sampleStats());
  }

  Future<void> _sampleStats() async {
    final manager = _peer;
    if (!_started || manager == null) return;
    final stats = await manager.getConnectionStats();
    if (!_started || _peer != manager) return;
    // Don't override the reconnecting "poor" hint with a (possibly stale) read.
    if (state.reconnecting) return;
    if (stats.quality == ConnectionQuality.unknown) return; // keep last good
    if (stats.quality != state.quality) {
      state = state.copyWith(quality: stats.quality);
    }
  }

  Future<void> _onOffer(RtcSdpPayload p) async {
    final manager = _peer;
    if (manager == null || p.roomId != _roomId) return;
    // A fresh offer arriving on an already-connected call is the initiator's
    // ICE-restart renegotiation — reflect "reconnecting" and arm a backstop so
    // we re-queue if the restart never lands. (Initial offer: status is still
    // `connecting`, so this is a no-op.)
    if (state.status == RouletteStatus.connected && !state.reconnecting) {
      state = state.copyWith(reconnecting: true, quality: ConnectionQuality.poor);
      _armIceRestartBackstop();
    }
    await manager.setRemoteDescription('offer', p.sdp);
    final sdp = await manager.createAnswer();
    final room = _roomId;
    if (room != null) _socket.rtcAnswer(room, sdp);
  }

  Future<void> _onAnswer(RtcSdpPayload p) async {
    final manager = _peer;
    if (manager == null || p.roomId != _roomId) return;
    await manager.setRemoteDescription('answer', p.sdp);
  }

  Future<void> _onIce(RtcIcePayload p) async {
    final manager = _peer;
    if (manager == null || p.roomId != _roomId) return;
    final candidate = p.candidate;
    if (candidate is Map) {
      await manager.addIceCandidate(RTCIceCandidate(
        candidate['candidate'] as String?,
        candidate['sdpMid'] as String?,
        (candidate['sdpMLineIndex'] as num?)?.toInt(),
      ));
    }
  }

  /// The PEER left (hangup / disconnect / connection failure). Tear down the
  /// local peer, show the "ended" interstitial, then auto-requeue. We must
  /// re-`mm:join` (not `mm:next`) since the room is already gone server-side.
  void _handlePeerGone() {
    if (!_started) return;
    _closePeer();
    state = state.copyWith(status: RouletteStatus.ended, clearRemoteStream: true);
    _clearRequeueTimer();
    _requeueTimer = Timer(_kRequeueDelay, () {
      if (!_started) return;
      if (_socket.isConnected) {
        _emitJoin();
      } else {
        // Offline: reflect searching; the onConnect handler will join on
        // reconnect (the socket auto-reconnects with backoff).
        state = state.copyWith(status: RouletteStatus.searching, clearPositionHint: true);
        _armMatchTimeout();
      }
    });
  }

  Future<void> _closePeer() async {
    final peer = _peer;
    _peer = null;
    _roomId = null;
    _isInitiator = false;
    // Stop all reconnect/quality timers so they never fire against a dead peer.
    _resetCallHealth();
    // Screening is per-call; stop sampling when the peer goes away.
    _stopScreening();
    await peer?.close();
  }

  // ──────────────────── On-device NSFW screening (local) ───────────────────
  /// Lazily build the screening controller + bind its `flagged` changes once.
  LocalScreeningController _ensureScreening() {
    final existing = _screening;
    if (existing != null) return existing;
    final controller = LocalScreeningController(
      reportFrame: (dto) => ref.read(apiClientProvider).reportModerationFrame(dto),
    );
    controller.addListener(_onScreeningChanged);
    _screening = controller;
    return controller;
  }

  /// (Re)bind screening to the current local stream for the active video match.
  /// No-op for voice (no video to screen). Safe to call repeatedly.
  void _syncScreening() {
    if (!_isVideo) return;
    final live = _peer != null &&
        (state.status == RouletteStatus.connecting ||
            state.status == RouletteStatus.connected);
    _ensureScreening().update(
      stream: live ? _localStream : null,
      matchId: _roomId,
      enabled: live,
      onViolation: (_) {
        // The screen surfaces a gentle "your video was hidden" toast off the
        // `flagged` state flip; nothing else needed here.
      },
    );
  }

  void _stopScreening() {
    _videoCutByScreening = false;
    _screening?.update(stream: null, matchId: null, enabled: false);
  }

  /// React to a screening flag change: mirror it into [RouletteState.flagged]
  /// and disable/enable the OUTBOUND local video track so offending frames
  /// never reach the peer (mirrors the web stage's track-disable effect).
  void _onScreeningChanged() {
    final flagged = _screening?.flagged ?? false;
    if (flagged == state.flagged) return;

    final videoTracks = _localStream?.getVideoTracks() ?? const [];
    if (flagged) {
      if (videoTracks.isNotEmpty) {
        for (final t in videoTracks) {
          t.enabled = false;
        }
        _videoCutByScreening = true;
      }
    } else {
      // Un-flag (cooldown elapsed) → restore video UNLESS the user muted it.
      if (_videoCutByScreening && !state.cameraOff) {
        for (final t in videoTracks) {
          t.enabled = true;
        }
      }
      _videoCutByScreening = false;
    }
    state = state.copyWith(flagged: flagged);
  }

  // ──────────────────────── ICE servers (cached) ──────────────────────────
  Future<void> _ensureIceServers() async {
    if (_iceServers != null) return;
    _iceServers = await _turn.fetchIceServers();
  }

  // ───────────────────────────── Public API ───────────────────────────────

  /// Start a session: permissions → media → ICE → connect → join the queue.
  Future<void> start() async {
    if (_started || state.isStarting) return;

    // Auth guard (mirrors the web): a session token is required.
    final authed = ref.read(authStateProvider).isAuthenticated;
    if (!authed) {
      state = state.copyWith(
        status: RouletteStatus.error,
        error: const RouletteError(kind: 'auth', message: 'Войдите в аккаунт, чтобы начать общение.'),
      );
      return;
    }

    _wireSocket();
    state = state.copyWith(status: RouletteStatus.requesting, isStarting: true, clearError: true);

    try {
      // 1) OS permissions, then local media — fail fast on device problems.
      await MediaPermissions.ensure(video: _isVideo);
      final stream = await getLocalStream(video: _isVideo);
      _localStream = stream;

      // 2) ICE servers (best-effort; STUN fallback otherwise).
      await _ensureIceServers();

      // 3) Mark started + reflect "searching" immediately, then connect. The
      //    onConnect handler emits the initial `mm:join`; if the socket was
      //    already connected (quick stop→start) we emit directly below.
      _started = true;
      state = state.copyWith(
        status: RouletteStatus.searching,
        localStream: stream,
        micMuted: false,
        cameraOff: false,
        isStarting: false,
        clearError: true,
      );
      _armMatchTimeout();

      _socket.connect();
      if (_socket.isConnected && _peer == null && _roomId == null) {
        _socket.mmJoin(_type, state.filters);
      }
    } on MediaException catch (e) {
      _started = false;
      state = state.copyWith(
        status: RouletteStatus.error,
        isStarting: false,
        error: RouletteError.fromMedia(e),
      );
    } catch (_) {
      _started = false;
      state = state.copyWith(
        status: RouletteStatus.error,
        isStarting: false,
        error: const RouletteError(kind: 'unknown', message: 'Не удалось запустить. Попробуйте ещё раз.'),
      );
    }
  }

  /// Skip to the next partner. `mm:next` tears down the current room AND
  /// re-queues us with the same type/filters (server-remembered), so we do NOT
  /// emit `mm:join` here.
  Future<void> next() async {
    if (!_started) return;
    _clearRequeueTimer();

    final room = _roomId;
    if (room != null) {
      // Proactively hang up so the peer tears down instantly.
      _socket.rtcHangup(room, reason: MatchEndReason.next);
    }
    _socket.mmNext();

    await _closePeer();
    state = state.copyWith(
      status: RouletteStatus.searching,
      clearRoomId: true,
      clearPeer: true,
      clearRemoteStream: true,
      clearPositionHint: true,
      chatMessages: const [],
      chatOpen: false,
      quality: ConnectionQuality.unknown,
      reconnecting: false,
    );
    _armMatchTimeout();
  }

  /// End the session entirely: hang up, leave the queue, stop local media.
  ///
  /// IMPORTANT: this leaves the matchmaking queue with `mm:leave` but does NOT
  /// disconnect the socket. The `/mm` socket is SHARED app-wide (presence,
  /// notifications, incoming friend-calls) and owned by the auth lifecycle
  /// (connected on login, disconnected on logout) — exactly like the web client.
  /// Tearing it down here would kill app-wide realtime until the next login.
  Future<void> stop() async {
    final room = _roomId;
    if (room != null) _socket.rtcHangup(room, reason: MatchEndReason.stop);

    _started = false;
    _clearMatchTimer();
    _clearRequeueTimer();
    _socket.mmLeave();

    await _closePeer();
    await stopStream(_localStream);
    _localStream = null;
    _iceServers = null;

    // Reset to idle, preserving filters so a re-Start keeps the user's choices.
    state = RouletteState(filters: state.filters);
  }

  // ────────────────────────── Media toggles ───────────────────────────────
  void toggleMic() {
    final stream = _localStream;
    if (stream == null) return;
    final audio = stream.getAudioTracks();
    if (audio.isEmpty) return;
    final willMute = audio.first.enabled; // currently on → muting
    for (final t in audio) {
      t.enabled = !willMute;
    }
    state = state.copyWith(micMuted: willMute);
  }

  /// Toggle the local camera. Tracks the user's INTENT in [RouletteState.cameraOff]
  /// and only physically re-enables the outbound video track when screening
  /// isn't currently suppressing it — otherwise turning the camera back "on"
  /// would push screening-flagged frames to the peer. When the screening flag
  /// later clears, [_onScreeningChanged] restores the track honoring this intent.
  void toggleCamera() {
    final stream = _localStream;
    if (stream == null) return;
    final video = stream.getVideoTracks();
    if (video.isEmpty) return;
    // Derive the new intent from the current state, NOT the track's enabled flag
    // (the track may be disabled by screening while the user intends it on).
    final willTurnOff = !state.cameraOff; // off → on toggles intent
    final screeningSuppressed = _videoCutByScreening && (_screening?.flagged ?? false);
    for (final t in video) {
      if (willTurnOff) {
        t.enabled = false;
      } else if (!screeningSuppressed) {
        // Only re-enable when screening isn't actively cutting the feed.
        t.enabled = true;
      }
    }
    state = state.copyWith(cameraOff: willTurnOff);
  }

  /// Flip the front/back camera (video mode).
  Future<void> switchCamera() async {
    final video = _localStream?.getVideoTracks() ?? const [];
    if (video.isEmpty) return;
    try {
      await Helper.switchCamera(video.first);
    } catch (e) {
      if (kDebugMode) debugPrint('[roulette] switchCamera failed: $e');
    }
  }

  // ─────────────────────────── Filters / chat ─────────────────────────────
  /// Update the matchmaking filters. While searching, re-join immediately so
  /// the new criteria take effect; the next match honors them regardless.
  void setFilters(MatchFilters filters) {
    state = state.copyWith(filters: filters);
    if (_started && _peer == null && _socket.isConnected) {
      _emitJoin();
    }
  }

  void setChatOpen(bool open) => state = state.copyWith(chatOpen: open);

  /// Send an in-call chat message over the peer data channel. Returns false if
  /// the channel isn't open (or the text is blank).
  Future<bool> sendChatMessage(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return false;
    final ok = await (_peer?.sendChatMessage(trimmed) ?? Future.value(false));
    if (ok) _addChatLine(fromMe: true, text: trimmed);
    return ok;
  }

  void _addChatLine({required bool fromMe, required String text}) {
    final line = ChatLine(
      id: '${DateTime.now().microsecondsSinceEpoch}-${state.chatMessages.length}',
      fromMe: fromMe,
      text: text,
      at: DateTime.now(),
    );
    state = state.copyWith(chatMessages: [...state.chatMessages, line]);
  }

  // ───────────────────────────── Teardown ─────────────────────────────────
  void _disposeAll() {
    _started = false;
    _clearMatchTimer();
    _clearRequeueTimer();
    _resetCallHealth();
    _screening?.removeListener(_onScreeningChanged);
    _screening?.dispose();
    _screening = null;
    for (final off in _subs) {
      off();
    }
    _subs.clear();
    final room = _roomId;
    try {
      if (room != null) _socket.rtcHangup(room, reason: MatchEndReason.stop);
      _socket.mmLeave();
    } catch (_) {
      /* socket may already be down */
    }
    // Fire-and-forget async cleanup (provider is going away).
    unawaited(_closePeer());
    unawaited(stopStream(_localStream));
    _localStream = null;
    // Do NOT disconnect the socket here: it is the SHARED app-wide `/mm` +
    // `/chat` connection (presence, notifications, incoming calls) owned by the
    // auth lifecycle. We only left the queue (`mm:leave`) above; the socket
    // stays live so leaving the roulette never kills app-wide realtime.
  }
}

/// The roulette engine, one instance per [MatchType] (video / voice).
final rouletteControllerProvider =
    NotifierProvider.family<RouletteController, RouletteState, MatchType>(
  RouletteController.new,
);
