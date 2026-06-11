/// App-wide on-device NSFW screening service.
///
/// The shipping default is INERT: without the operator-provisioned model
/// asset (`assets/models/nsfw.tflite`) OR with the env switch
/// [kNsfwEnabled] `false`, [enabled] stays false and every [classify] call
/// returns SAFE. This file is the SCAFFOLD the task asked for; the live
/// per-call screening loop in `features/roulette/data/local_screening.dart`
/// remains the primary detector inside an active video call.
///
/// Wiring overview:
///   • At app boot, call [NsfwService.instance.tryLoad()]. It:
///       1. Returns early when [kNsfwEnabled] is false (no asset I/O).
///       2. Probes the asset by delegating to the existing
///          `installTfliteNsfwClassifier()` in
///          `features/roulette/data/nsfw_classifier.dart`. That function
///          loads + immediately closes a probe interpreter, then registers
///          the real backend factory so per-call sessions get a live
///          classifier. We re-use it so there's exactly ONE asset probe.
///       3. On success, swaps this scaffold's factory to the backend adapter
///          ([installBackendFactory]) and flips [enabled] to true.
///   • During an active call, [BatteryAwareSamplerGate.shouldSampleNow]
///     decides whether to skip the next sample tick (battery / low-power
///     equivalents — see [BatterySignal]).
///   • The HOT screening loop in `local_screening.dart` is unchanged — it
///     already debounces, captures, classifies, and POSTs to
///     `/moderation/frame`. The NEW client-signal channel
///     ([NsfwService.reportClientSignal]) is wired separately so an operator
///     can fan out the lighter-weight signal stream without touching the
///     existing local-cut policy.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../config/safety_config.dart';
import '../../features/roulette/data/nsfw_classifier.dart' as backend;
import 'nsfw_classifier.dart';

/// A pluggable battery / low-power signal so the sampler can throttle on
/// devices that report low battery or are in OS power-save mode. Default
/// implementation is a no-op (battery `100`, normal power) — projects that
/// want real signal should override via [setBatterySignal] using a plugin
/// like `battery_plus`. Returning `null` from any getter means "unknown" and
/// the gate treats unknown as "don't throttle".
abstract class BatterySignal {
  /// Battery level in [0, 100], or null if unknown.
  Future<int?> batteryLevel();

  /// True when the OS reports low-power / battery-saver mode is active.
  Future<bool> isLowPowerMode();
}

class _NoopBatterySignal implements BatterySignal {
  const _NoopBatterySignal();

  @override
  Future<int?> batteryLevel() async => null;

  @override
  Future<bool> isLowPowerMode() async => false;
}

BatterySignal _batterySignal = const _NoopBatterySignal();

/// Override the battery signal source (e.g. once a `battery_plus` adapter is
/// wired in). Safe to call at any time; the next sampler tick picks it up.
void setBatterySignal(BatterySignal signal) {
  _batterySignal = signal;
}

/// Cooperative gate the call sampler consults BEFORE each sample tick. Returns
/// false when battery is below [kNsfwBatteryThrottlePercent] OR low-power mode
/// is active; the caller then skips this cycle.
class BatteryAwareSamplerGate {
  const BatteryAwareSamplerGate();

  /// True iff the next sample tick should run. Defensive: any exception in
  /// the battery probe degrades to "let it run" — we never want a flaky
  /// battery channel to silently disable screening.
  Future<bool> shouldSampleNow() async {
    try {
      final lvl = await _batterySignal.batteryLevel();
      if (lvl != null && lvl < kNsfwBatteryThrottlePercent) return false;
      final lowPower = await _batterySignal.isLowPowerMode();
      if (lowPower) return false;
      return true;
    } catch (_) {
      return true;
    }
  }
}

/// A reporter for the client-signal channel. Implementations POST to the API
/// server (typically `/moderation/client-signal`). The default
/// implementation is a no-op so the scaffold compiles without an API
/// dependency edge; the integrator wires the real one in via
/// [setClientSignalReporter] (see `apps/mobile/lib/main.dart`).
typedef ClientSignalReporter = Future<void> Function(
  ClientSignalPayload payload,
);

/// The wire payload mirrors the shared-types `ClientSignalDto` (see the new
/// `apps/api/src/modules/moderation/moderation.controller.ts` endpoint).
@immutable
class ClientSignalPayload {
  const ClientSignalPayload({
    required this.scores,
    required this.aggregate,
    this.matchId,
  });

  /// Per-class breakdown in [0, 1].
  final NsfwScores scores;

  /// The combined `porn + hentai + sexy` score (`scores.nsfwAggregate`).
  final double aggregate;

  /// The active match id when available, so the server can correlate.
  final String? matchId;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'aggregate': aggregate,
        'scores': scores.toMap(),
        if (matchId != null) 'matchId': matchId,
      };
}

Future<void> _noopReporter(ClientSignalPayload _) async {}

ClientSignalReporter _reporter = _noopReporter;

/// Override the reporter — typically wired in `main.dart` to forward to the
/// API client's `POST /moderation/client-signal` endpoint.
void setClientSignalReporter(ClientSignalReporter reporter) {
  _reporter = reporter;
}

/// Singleton service the rest of the app interacts with.
class NsfwService {
  NsfwService._();

  /// The singleton — only one [NsfwService] per process.
  static final NsfwService instance = NsfwService._();

  bool _enabled = false;
  bool _loadAttempted = false;

  /// True iff the env switch is on AND the asset loaded successfully AND the
  /// service has been initialized via [tryLoad]. Anything else → false.
  bool get enabled => _enabled;

  /// The gate the in-call sampler should consult before each tick. See
  /// [BatteryAwareSamplerGate.shouldSampleNow].
  final BatteryAwareSamplerGate samplerGate = const BatteryAwareSamplerGate();

  /// Sample interval — driven by [kNsfwSampleIntervalSeconds].
  Duration get sampleInterval =>
      Duration(seconds: kNsfwSampleIntervalSeconds);

  /// Probe the asset + activate the backend if both gates agree.
  ///
  /// Returns `true` iff the service is now [enabled]. Never throws — every
  /// failure path degrades to "screening off, app still boots". Idempotent:
  /// subsequent calls return the cached result without re-probing.
  Future<bool> tryLoad() async {
    if (_loadAttempted) return _enabled;
    _loadAttempted = true;

    // Gate 1: env switch. When off, skip the probe entirely (no disk I/O).
    if (!kNsfwEnabled) {
      if (kDebugMode) {
        debugPrint(
          '[nsfw] disabled by build (NSFW_ENABLED=false). Pass '
          '--dart-define=NSFW_ENABLED=true to enable.',
        );
      }
      return false;
    }

    // Gate 2: asset presence. We delegate to the existing per-call backend's
    // installer so there's exactly ONE asset probe in the boot path and the
    // success path also primes its factory for the live screening loop.
    final activated = await backend.installTfliteNsfwClassifier(
      assetPath: kNsfwModelAssetPath,
    );
    if (!activated) {
      // Probe failed (asset missing or unloadable). Stay inert.
      return false;
    }

    // Wire the scaffold's factory to the backend adapter so callers outside
    // the call loop can score frames against the same model.
    installBackendFactory();
    _enabled = true;
    if (kDebugMode) {
      debugPrint(
        '[nsfw] service active (sample=${sampleInterval.inSeconds}s, '
        'client-signal>=${kClientSignalThreshold.toStringAsFixed(2)}, '
        'battery-throttle<$kNsfwBatteryThrottlePercent%)',
      );
    }
    return true;
  }

  /// Reset for tests. Production code should never call this.
  @visibleForTesting
  void resetForTests() {
    _enabled = false;
    _loadAttempted = false;
  }

  /// Classify one JPEG frame against the configured backend. Returns SAFE
  /// when the service is disabled; the per-frame classifier itself is
  /// defensive and never throws.
  Future<NsfwInferenceResult> classify(Uint8List frameJpeg) async {
    if (!_enabled) return NsfwInferenceResult.safe;
    final c = buildNsfwClassifier();
    try {
      return await c.classify(frameJpeg);
    } finally {
      // The backend adapter holds a live interpreter; the boot-time caller
      // (the overlay) doesn't own the interpreter lifecycle (the per-call
      // backend does), so disposing here is a no-op for the SAFE / no-op
      // path and a session-end close for the adapter path.
      c.dispose();
    }
  }

  /// Emit a client-signal to the server (best-effort, non-blocking). Caller
  /// supplies the inference result + the active match id; the service builds
  /// the payload and delegates to the configured reporter.
  Future<void> reportClientSignal({
    required NsfwInferenceResult result,
    String? matchId,
  }) async {
    if (!_enabled) return;
    if (!result.tripped) return;
    try {
      await _reporter(
        ClientSignalPayload(
          scores: result.scores,
          aggregate: result.scores.nsfwAggregate,
          matchId: matchId,
        ),
      );
    } catch (e) {
      if (kDebugMode) {
        debugPrint('[nsfw] client-signal report failed: $e');
      }
    }
  }
}
