/// On-call safety overlay — the scaffolding hook that drives the lighter-
/// weight `client-signal` channel during an active video call.
///
/// This widget is OPTIONAL and INERT by default:
///   • When [NsfwService.enabled] is false (env switch off OR asset absent),
///     the overlay never starts a timer + renders nothing. The legacy
///     screening pipeline in
///     `features/roulette/presentation/widgets/video_tile.dart` +
///     `features/roulette/data/local_screening.dart` still owns the local-cut
///     decision. Mounting this overlay alongside is safe and additive.
///   • When enabled, every [NsfwService.sampleInterval] it (a) consults
///     [BatteryAwareSamplerGate.shouldSampleNow] (battery / low-power skip),
///     (b) captures one JPEG frame from the local video track, (c) scores it
///     via [NsfwService.classify], and (d) on a `tripped` result, fires
///     [NsfwService.reportClientSignal] (best-effort, fire-and-forget).
///
/// The overlay does NOT terminate the call locally — the server owns
/// escalation (the existing `mod:action` flow already handles warn / kick /
/// ban). It only feeds a signal; even a sustained run of `tripped` results
/// stays an advisory until the server acts.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../../core/safety/nsfw_service.dart';

/// Hook point the parent call screen uses. Mount once near the root of the
/// call tree with the live local stream + match id; safe to keep mounted for
/// the duration of the call (it self-cancels on dispose).
class CallSafetyOverlay extends StatefulWidget {
  const CallSafetyOverlay({
    super.key,
    required this.localStream,
    required this.matchId,
    required this.active,
    this.child,
  });

  /// The live LOCAL media stream (the one our camera is producing). When null
  /// or video-less, the overlay stays idle.
  final MediaStream? localStream;

  /// The active match id, threaded into each client-signal report so the
  /// server can correlate signals to a single conversation.
  final String? matchId;

  /// True only while the call is actually connecting / connected. Lets the
  /// parent stop sampling during status screens without unmounting.
  final bool active;

  /// Optional child — the overlay is INVISIBLE itself; passing a child makes
  /// it a pass-through wrapper for ergonomic mounting inside an existing tree.
  final Widget? child;

  @override
  State<CallSafetyOverlay> createState() => _CallSafetyOverlayState();
}

class _CallSafetyOverlayState extends State<CallSafetyOverlay> {
  Timer? _timer;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _syncTimer();
  }

  @override
  void didUpdateWidget(covariant CallSafetyOverlay old) {
    super.didUpdateWidget(old);
    if (old.localStream != widget.localStream || old.active != widget.active) {
      _syncTimer();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _timer = null;
    super.dispose();
  }

  void _syncTimer() {
    final service = NsfwService.instance;
    final shouldRun = service.enabled &&
        widget.active &&
        widget.localStream != null &&
        widget.localStream!.getVideoTracks().isNotEmpty;

    _timer?.cancel();
    _timer = null;

    if (!shouldRun) return;

    _timer = Timer.periodic(
      service.sampleInterval,
      (_) => unawaited(_tick()),
    );
  }

  /// One sample tick: gate → capture → classify → report. Always returns
  /// without throwing.
  Future<void> _tick() async {
    if (_busy || !mounted) return;
    final service = NsfwService.instance;
    if (!service.enabled) return;

    // Battery / low-power gate — skip this cycle if the device is throttled.
    final allowed = await service.samplerGate.shouldSampleNow();
    if (!allowed) return;

    final track = widget.localStream?.getVideoTracks().firstOrNull;
    if (track == null) return;

    _busy = true;
    try {
      Uint8List frame;
      try {
        final buf = await track.captureFrame();
        frame = buf.asUint8List();
      } catch (_) {
        return; // camera warming up or unsupported — skip
      }
      if (frame.isEmpty) return;

      final result = await service.classify(frame);
      if (!result.tripped) return;

      // Fire-and-forget — never block the next tick on a slow network.
      unawaited(
        service.reportClientSignal(
          result: result,
          matchId: widget.matchId,
        ),
      );
    } catch (_) {
      // Defensive: any uncaught path degrades to "skip this tick".
    } finally {
      _busy = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    // Invisible by design — the overlay is wiring, not chrome. Passing a child
    // lets callers mount this as a `Stack` sibling or a pass-through wrapper.
    return widget.child ?? const SizedBox.shrink();
  }
}
