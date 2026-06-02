import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

/// WebRTC helpers for ruletka.top mobile — owned by the roulette feature.
///
/// A faithful port of the web's `apps/web/src/lib/webrtc.ts`, adapted to
/// `flutter_webrtc`. Intentionally signaling-agnostic: this layer wraps the raw
/// `getUserMedia` / `RTCPeerConnection` APIs behind small, testable helpers so
/// the roulette controller stays focused on orchestration + the socket
/// contract. The controller wires the manager's callbacks ([onIceCandidate],
/// [onRemoteStream], [onConnectionState]) to the typed `rtc:*` events and feeds
/// remote SDP / ICE back in via [setRemoteDescription] / [addIceCandidate].

// ─────────────────────────────── ICE config ───────────────────────────────

/// One ICE server entry, matching the `RTCPeerConnection({ iceServers })`
/// shape. Mirrors the `/turn/credentials` response (`{ urls, username,
/// credential }`); not part of the shared Zod contract.
class IceServerConfig {
  const IceServerConfig({required this.urls, this.username, this.credential});

  /// A single URL or a list of URLs (`stun:` / `turn:` / `turns:`).
  final dynamic urls;
  final String? username;
  final String? credential;

  factory IceServerConfig.fromJson(Map<String, dynamic> json) => IceServerConfig(
        urls: json['urls'] ?? json['url'],
        username: json['username'] as String?,
        credential: json['credential'] as String?,
      );

  Map<String, dynamic> toMap() => {
        'urls': urls,
        if (username != null) 'username': username,
        if (credential != null) 'credential': credential,
      };
}

/// A safe default ICE configuration (public STUN only). Used as a fallback when
/// `/turn/credentials` is unreachable so a same-network / non-NAT call can still
/// connect during local development.
const List<IceServerConfig> kFallbackIceServers = [
  IceServerConfig(urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']),
];

// ───────────────────────────── Media helpers ──────────────────────────────

/// Distinct, user-actionable failure modes when acquiring local media. Mirrors
/// the web `MediaErrorKind`, plus [permanentlyDenied] (mobile-only: the OS
/// permission was permanently denied and we must deep-link to Settings).
enum MediaErrorKind { denied, permanentlyDenied, notfound, inuse, insecure, unknown }

/// A typed local-media failure carrying a coarse [kind] the UI branches on.
class MediaException implements Exception {
  MediaException(this.kind, this.message);

  final MediaErrorKind kind;
  final String message;

  @override
  String toString() => 'MediaException($kind): $message';
}

/// Acquire a local [MediaStream]. [video] requests a sensible 720p ideal (front
/// camera on mobile); audio is always requested with echo cancellation + noise
/// suppression for a clean call.
///
/// Throws a [MediaException] with a coarse [MediaErrorKind] the UI can branch
/// on. Permission *prompting* is handled separately (permission_handler) before
/// this is called; here we still classify any late failure.
Future<MediaStream> getLocalStream({required bool video}) async {
  final constraints = <String, dynamic>{
    'audio': {
      'echoCancellation': true,
      'noiseSuppression': true,
      'autoGainControl': true,
    },
    'video': video
        ? {
            'facingMode': 'user',
            'mandatory': {
              'minWidth': '640',
              'minHeight': '480',
              'minFrameRate': '15',
            },
            'optional': [
              {'minWidth': '1280'},
              {'minHeight': '720'},
            ],
          }
        : false,
  };

  try {
    final stream = await navigator.mediaDevices.getUserMedia(constraints);
    return stream;
  } catch (err) {
    throw MediaException(_classifyMediaError(err), _mediaMessage(_classifyMediaError(err), video));
  }
}

MediaErrorKind _classifyMediaError(Object err) {
  final text = err.toString().toLowerCase();
  if (text.contains('notallowed') || text.contains('permissiondenied') || text.contains('denied')) {
    return MediaErrorKind.denied;
  }
  if (text.contains('notfound') || text.contains('overconstrained') || text.contains('devicesnotfound')) {
    return MediaErrorKind.notfound;
  }
  if (text.contains('notreadable') || text.contains('abort') || text.contains('inuse') || text.contains('busy')) {
    return MediaErrorKind.inuse;
  }
  return MediaErrorKind.unknown;
}

String _mediaMessage(MediaErrorKind kind, bool video) => switch (kind) {
      MediaErrorKind.denied || MediaErrorKind.permanentlyDenied => video
          ? 'Доступ к камере и микрофону запрещён. Разрешите доступ в настройках.'
          : 'Доступ к микрофону запрещён. Разрешите доступ в настройках.',
      MediaErrorKind.notfound =>
        video ? 'Камера или микрофон не найдены.' : 'Микрофон не найден.',
      MediaErrorKind.inuse =>
        'Устройство занято другим приложением. Закройте его и попробуйте снова.',
      MediaErrorKind.insecure => 'Камера и микрофон недоступны на этом устройстве.',
      MediaErrorKind.unknown => 'Не удалось получить доступ к устройствам.',
    };

/// Stop every track on a stream and dispose it (idempotent, null-safe).
Future<void> stopStream(MediaStream? stream) async {
  if (stream == null) return;
  for (final track in [...stream.getTracks()]) {
    try {
      await track.stop();
    } catch (_) {
      /* already stopped */
    }
  }
  try {
    await stream.dispose();
  } catch (_) {
    /* already disposed */
  }
}

// ─────────────────────────── Connection quality ───────────────────────────

/// Coarse, user-facing call-quality buckets derived from live `getStats()`
/// samples (RTT / packet-loss / jitter). Mirrors the web client's quality
/// model. [unknown] means we have no usable sample yet (or stats are
/// unavailable on this device) — the UI hides the indicator in that case.
enum ConnectionQuality { unknown, poor, fair, good, excellent }

/// A single parsed `getStats()` snapshot for the active connection. All fields
/// are best-effort: any metric the platform doesn't expose stays null and the
/// [quality] degrades gracefully around what's available.
class CallStats {
  const CallStats({
    required this.quality,
    this.rttMs,
    this.packetLossPct,
    this.jitterMs,
  });

  /// The derived quality bucket the UI renders.
  final ConnectionQuality quality;

  /// Round-trip time in milliseconds (from the active candidate pair), if known.
  final double? rttMs;

  /// Fraction of inbound packets lost since the previous sample, 0–100, if known.
  final double? packetLossPct;

  /// Inbound jitter in milliseconds, if known.
  final double? jitterMs;

  static const CallStats unknown = CallStats(quality: ConnectionQuality.unknown);
}

/// Classify a sample into a [ConnectionQuality] bucket using the worst of the
/// three signals (RTT / loss / jitter). Thresholds mirror the web heuristic and
/// common WebRTC dashboards. Any null metric is simply ignored.
ConnectionQuality _scoreQuality({double? rttMs, double? lossPct, double? jitterMs}) {
  // Map each available metric onto a 0..3 score (3 == excellent), then take the
  // worst. If nothing is available, the caller keeps the previous/unknown value.
  final scores = <int>[];

  if (rttMs != null) {
    scores.add(rttMs < 150
        ? 3
        : rttMs < 300
            ? 2
            : rttMs < 500
                ? 1
                : 0);
  }
  if (lossPct != null) {
    scores.add(lossPct < 1
        ? 3
        : lossPct < 4
            ? 2
            : lossPct < 8
                ? 1
                : 0);
  }
  if (jitterMs != null) {
    scores.add(jitterMs < 30
        ? 3
        : jitterMs < 60
            ? 2
            : jitterMs < 100
                ? 1
                : 0);
  }

  if (scores.isEmpty) return ConnectionQuality.unknown;
  final worst = scores.reduce((a, b) => a < b ? a : b);
  return switch (worst) {
    3 => ConnectionQuality.excellent,
    2 => ConnectionQuality.good,
    1 => ConnectionQuality.fair,
    _ => ConnectionQuality.poor,
  };
}

double? _asDouble(Object? v) {
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v);
  return null;
}

// ──────────────────────── Peer connection manager ─────────────────────────

/// Label for the in-call chat data channel (matches the web client).
const String _kChatChannelLabel = 'ruletka-chat';

/// Callbacks the controller wires to the typed `rtc:*` signaling events + UI.
class PeerManagerCallbacks {
  const PeerManagerCallbacks({
    required this.onIceCandidate,
    required this.onRemoteStream,
    required this.onConnectionState,
    this.onIceConnectionState,
    this.onDataMessage,
    this.onDataChannelOpen,
  });

  /// A local ICE candidate was gathered — forward it over signaling.
  final void Function(RTCIceCandidate candidate) onIceCandidate;

  /// A remote media track arrived — attach its stream to a renderer.
  final void Function(MediaStream stream) onRemoteStream;

  /// The aggregate connection state changed (drives the UI status).
  final void Function(RTCPeerConnectionState state) onConnectionState;

  /// The transport-level ICE state changed (drives reconnect: `disconnected`
  /// arms a grace timer, `failed` triggers an ICE restart). Optional: some
  /// platforms only fire the aggregate [onConnectionState]; the controller
  /// reacts to whichever it gets.
  final void Function(RTCIceConnectionState state)? onIceConnectionState;

  /// A text message arrived over the peer-to-peer data channel (in-call chat).
  final void Function(String text)? onDataMessage;

  /// The data channel opened/closed (drives chat availability).
  final void Function(bool open)? onDataChannelOpen;
}

/// Thin wrapper around a single [RTCPeerConnection] that:
///  - adds local tracks,
///  - emits gathered ICE candidates via a callback,
///  - surfaces the first remote stream,
///  - **queues remote ICE candidates** received before [setRemoteDescription]
///    has been applied (a classic glare/race pitfall), flushing them after.
///
/// One manager instance maps to one call; create a fresh one per match and
/// [close] it on hangup/next/stop.
class PeerConnectionManager {
  PeerConnectionManager(this._iceServers, this._callbacks);

  final List<IceServerConfig> _iceServers;
  final PeerManagerCallbacks _callbacks;

  RTCPeerConnection? _pc;
  RTCDataChannel? _chatChannel;
  final List<RTCIceCandidate> _pendingCandidates = [];
  bool _hasRemoteDescription = false;
  bool _closed = false;

  // Running totals from the previous stats sample, so packet loss can be
  // expressed as a per-interval rate rather than a since-forever cumulative.
  double? _prevPacketsLost;
  double? _prevPacketsReceived;

  /// Build the underlying connection and (optionally) the chat data channel.
  /// Must be awaited before [createOffer] / [addLocalStream].
  Future<void> init({required bool isInitiator, bool withChat = true}) async {
    final config = <String, dynamic>{
      'iceServers': _iceServers.map((s) => s.toMap()).toList(),
      'sdpSemantics': 'unified-plan',
      'bundlePolicy': 'max-bundle',
      'rtcpMuxPolicy': 'require',
    };
    final pc = await createPeerConnection(config);
    _pc = pc;
    _wire(pc);

    if (withChat) {
      if (isInitiator) {
        // The initiator creates the channel; it must exist BEFORE createOffer
        // so the SDP advertises it.
        final init = RTCDataChannelInit()..ordered = true;
        final channel = await pc.createDataChannel(_kChatChannelLabel, init);
        _attachChatChannel(channel);
      } else {
        // The answerer receives it via onDataChannel.
        pc.onDataChannel = (channel) {
          if (channel.label == _kChatChannelLabel) _attachChatChannel(channel);
        };
      }
    }
  }

  void _wire(RTCPeerConnection pc) {
    pc.onIceCandidate = (candidate) {
      // The native layer can emit an end-of-candidates sentinel with a null/
      // empty candidate string — skip it.
      final c = candidate.candidate;
      if (c != null && c.isNotEmpty) _callbacks.onIceCandidate(candidate);
    };

    pc.onTrack = (event) {
      if (event.streams.isNotEmpty) {
        _callbacks.onRemoteStream(event.streams.first);
      }
    };

    // Fallback for plugins/platforms that fire onAddStream instead of onTrack.
    pc.onAddStream = (stream) {
      _callbacks.onRemoteStream(stream);
    };

    pc.onConnectionState = (state) {
      if (_closed) return;
      _callbacks.onConnectionState(state);
    };

    pc.onIceConnectionState = (state) {
      if (_closed) return;
      _callbacks.onIceConnectionState?.call(state);
    };
  }

  void _attachChatChannel(RTCDataChannel channel) {
    _chatChannel = channel;
    channel.onDataChannelState = (state) {
      _callbacks.onDataChannelOpen?.call(state == RTCDataChannelState.RTCDataChannelOpen);
    };
    channel.onMessage = (message) {
      if (!message.isBinary) _callbacks.onDataMessage?.call(message.text);
    };
  }

  /// Send a text message over the in-call data channel. No-op if not open.
  Future<bool> sendChatMessage(String text) async {
    final channel = _chatChannel;
    if (channel == null) return false;
    try {
      await channel.send(RTCDataChannelMessage(text));
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Add every track of the local stream to the connection.
  Future<void> addLocalStream(MediaStream stream) async {
    final pc = _pc;
    if (pc == null) return;
    for (final track in stream.getTracks()) {
      await pc.addTrack(track, stream);
    }
  }

  /// Create an SDP offer, set it as the local description, return the SDP.
  Future<String> createOffer() async {
    final pc = _pc!;
    final offer = await pc.createOffer({
      'offerToReceiveAudio': true,
      'offerToReceiveVideo': true,
    });
    await pc.setLocalDescription(offer);
    return offer.sdp ?? '';
  }

  /// Create an SDP answer (after a remote offer), set it locally, return SDP.
  Future<String> createAnswer() async {
    final pc = _pc!;
    final answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer.sdp ?? '';
  }

  /// Build an **ICE-restart** offer and set it as the local description, then
  /// return the SDP. Wire-compatible with the existing signaling contract: the
  /// caller emits this over the normal `rtc:offer` event and the peer answers
  /// as usual — an ICE restart is just a renegotiation whose offer carries
  /// fresh ICE credentials (`iceRestart: true`).
  ///
  /// Only the initiator should call this (the answerer responds to the relayed
  /// offer via [setRemoteDescription] + [createAnswer]). Returns null if the
  /// connection is gone/closed or the platform fails to produce an offer, so
  /// the caller can fall back to a full re-queue without crashing the call.
  Future<String?> createIceRestartOffer() async {
    final pc = _pc;
    if (pc == null || _closed) return null;
    try {
      // Best-effort: nudge the ICE agent to gather fresh candidates. No-op on
      // platforms where it isn't supported; the `iceRestart` constraint below
      // is what actually forces new credentials into the offer.
      try {
        await pc.restartIce();
      } catch (_) {
        /* not supported on this platform — the offer constraint still works */
      }
      // Pass both the cross-platform (`iceRestart`) and the native libwebrtc
      // (`IceRestart`) constraint keys so the restart is honored everywhere.
      final offer = await pc.createOffer({
        'iceRestart': true,
        'IceRestart': true,
        'offerToReceiveAudio': true,
        'offerToReceiveVideo': true,
      });
      await pc.setLocalDescription(offer);
      return offer.sdp;
    } catch (_) {
      return null;
    }
  }

  /// Poll the connection once and parse a coarse [CallStats] snapshot
  /// (RTT / packet-loss rate / jitter → a [ConnectionQuality] bucket).
  ///
  /// Fully defensive: returns [CallStats.unknown] (never throws) if the
  /// connection is gone, `getStats()` is unavailable, or no usable report is
  /// present — so a device that doesn't surface stats simply shows no badge.
  Future<CallStats> getConnectionStats() async {
    final pc = _pc;
    if (pc == null || _closed) return CallStats.unknown;

    List<StatsReport> reports;
    try {
      reports = await pc.getStats();
    } catch (_) {
      return CallStats.unknown;
    }

    double? rttMs;
    double? jitterMs;
    double? packetsLost;
    double? packetsReceived;

    for (final r in reports) {
      final v = r.values;
      switch (r.type) {
        case 'candidate-pair':
          // Prefer the nominated/selected pair's RTT. `currentRoundTripTime` is
          // in seconds (spec). Only trust a pair that's actually in use.
          final selected = v['selected'] == true || v['nominated'] == true;
          final crtt = _asDouble(v['currentRoundTripTime']);
          if (crtt != null && (selected || rttMs == null)) {
            rttMs = crtt * 1000.0;
          }
          break;
        case 'inbound-rtp':
          // Aggregate loss/jitter across inbound media (audio + video).
          final jit = _asDouble(v['jitter']); // seconds
          if (jit != null) {
            final jms = jit * 1000.0;
            // Keep the worst (largest) jitter across tracks.
            jitterMs = (jitterMs == null || jms > jitterMs) ? jms : jitterMs;
          }
          final pl = _asDouble(v['packetsLost']);
          if (pl != null) packetsLost = (packetsLost ?? 0) + pl;
          final pr = _asDouble(v['packetsReceived']);
          if (pr != null) packetsReceived = (packetsReceived ?? 0) + pr;
          break;
        case 'remote-inbound-rtp':
          // Fallback RTT source (the remote's view) + outbound-path loss.
          final rtt = _asDouble(v['roundTripTime']); // seconds
          if (rtt != null && rttMs == null) rttMs = rtt * 1000.0;
          final jit = _asDouble(v['jitter']);
          if (jit != null && jitterMs == null) jitterMs = jit * 1000.0;
          break;
        default:
          break;
      }
    }

    // Convert cumulative loss into a per-interval percentage using the deltas
    // since the previous sample (the first sample seeds the baseline).
    double? lossPct;
    if (packetsLost != null && packetsReceived != null) {
      final prevLost = _prevPacketsLost;
      final prevRecv = _prevPacketsReceived;
      if (prevLost != null && prevRecv != null) {
        final dLost = (packetsLost - prevLost).clamp(0, double.infinity);
        final dRecv = (packetsReceived - prevRecv).clamp(0, double.infinity);
        final total = dLost + dRecv;
        if (total > 0) lossPct = (dLost / total) * 100.0;
      }
      _prevPacketsLost = packetsLost;
      _prevPacketsReceived = packetsReceived;
    }

    final quality = _scoreQuality(rttMs: rttMs, lossPct: lossPct, jitterMs: jitterMs);
    return CallStats(
      quality: quality,
      rttMs: rttMs,
      packetLossPct: lossPct,
      jitterMs: jitterMs,
    );
  }

  /// Apply a remote SDP description (`offer` | `answer`). Once applied, any ICE
  /// candidates that arrived early are flushed in order.
  Future<void> setRemoteDescription(String type, String sdp) async {
    final pc = _pc;
    if (pc == null || _closed) return;
    await pc.setRemoteDescription(RTCSessionDescription(sdp, type));
    _hasRemoteDescription = true;
    await _flushPendingCandidates();
  }

  /// Add a remote ICE candidate. If the remote description isn't set yet, the
  /// candidate is queued and applied later by [_flushPendingCandidates].
  Future<void> addIceCandidate(RTCIceCandidate candidate) async {
    if (_closed) return;
    if (!_hasRemoteDescription) {
      _pendingCandidates.add(candidate);
      return;
    }
    try {
      await _pc?.addCandidate(candidate);
    } catch (_) {
      /* benign: candidate can race a renegotiation/close */
    }
  }

  Future<void> _flushPendingCandidates() async {
    final queued = [..._pendingCandidates];
    _pendingCandidates.clear();
    for (final candidate in queued) {
      try {
        await _pc?.addCandidate(candidate);
      } catch (_) {
        /* ignore individual failures */
      }
    }
  }

  /// Current aggregate connection state (or null before [init]).
  RTCPeerConnectionState? get connectionState => _pc?.connectionState;

  /// Tear down the connection and detach all handlers. Idempotent.
  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    _pendingCandidates.clear();

    final pc = _pc;
    final channel = _chatChannel;
    _chatChannel = null;
    _pc = null;

    if (channel != null) {
      channel.onDataChannelState = null;
      channel.onMessage = null;
      try {
        await channel.close();
      } catch (_) {
        /* noop */
      }
    }

    if (pc != null) {
      pc
        ..onIceCandidate = null
        ..onTrack = null
        ..onAddStream = null
        ..onConnectionState = null
        ..onIceConnectionState = null
        ..onDataChannel = null;
      try {
        await pc.close();
        await pc.dispose();
      } catch (e) {
        if (kDebugMode) debugPrint('[webrtc] close error: $e');
      }
    }
  }
}
