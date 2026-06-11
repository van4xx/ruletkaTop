/// Scaffold loader for the on-device NSFW classifier.
///
/// This file is the THIN scaffolding the task asked for: a stable
/// `core/safety` surface that wraps the existing per-call screening backend
/// (`features/roulette/data/nsfw_classifier.dart` — the live TFLite
/// MobileNetV2 implementation that mirrors the web's nsfwjs). The two are
/// deliberately separated:
///
///   * `core/safety/` is the BOOT-TIME / APP-WIDE entry point. It probes the
///     asset, owns the env switch, and exposes one shared classifier instance
///     to anything that needs to score a frame outside the call loop.
///   * `features/roulette/data/` is the PER-CALL backend. Its factory still
///     owns the per-session interpreter lifecycle for the screening loop, so
///     the in-call hot path is untouched by this scaffolding.
///
/// The boot probe + the per-call classifier share the SAME asset and the same
/// `_kClassOrder` mapping (see the README at `assets/models/README.md`); this
/// file is only the loader + the read-only threshold table requested by the
/// task spec.
library;

import 'package:flutter/foundation.dart';

import '../config/safety_config.dart';
import '../../features/roulette/data/nsfw_classifier.dart' as backend;

// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY threshold table (mirrors the task spec).
//
// The LOCAL-cut policy lives in `local_screening.dart` (per-label thresholds
// 0.7 / 0.85, matching the web). These constants drive the lighter-weight
// `client-signal` channel: an aggregate `porn + hentai + sexy` score that the
// service POSTs to the server when it exceeds [kClientSignalThreshold]. The
// server is the authority — on-device never terminates the call locally off
// these signals.
// ─────────────────────────────────────────────────────────────────────────────

/// Combined NSFW-class confidence threshold at which we emit a client signal.
/// Sourced from [kNsfwClientSignalThreshold] (see `safety_config.dart`).
const double kClientSignalThreshold = kNsfwClientSignalThreshold;

/// Per-class index → label name. MUST match the model's training output order
/// (alphabetical) — see `assets/models/README.md`.
const List<String> kClassLabels = <String>[
  'drawings',
  'hentai',
  'neutral',
  'porn',
  'sexy',
];

/// A breakdown of per-class scores in [0,1]. All five classes are always
/// populated (missing → 0). Returned by [NsfwClassifier.classify].
@immutable
class NsfwScores {
  const NsfwScores({
    required this.drawings,
    required this.hentai,
    required this.neutral,
    required this.porn,
    required this.sexy,
  });

  final double drawings;
  final double hentai;
  final double neutral;
  final double porn;
  final double sexy;

  /// The all-safe vector returned when screening is disabled / unavailable.
  static const NsfwScores safe = NsfwScores(
    drawings: 0,
    hentai: 0,
    neutral: 1,
    porn: 0,
    sexy: 0,
  );

  /// The aggregate "is this NSFW?" signal the client-signal channel uses.
  /// `porn + hentai + sexy`, capped at 1 so a degenerate vector that sums to
  /// >1 (an un-softmaxed model) can't trip the gate spuriously.
  double get nsfwAggregate {
    final s = porn + hentai + sexy;
    return s > 1 ? 1 : s;
  }

  Map<String, double> toMap() => <String, double>{
        'drawings': drawings,
        'hentai': hentai,
        'neutral': neutral,
        'porn': porn,
        'sexy': sexy,
      };
}

/// One inference result: the per-class breakdown + whether it crosses the
/// client-signal threshold.
@immutable
class NsfwInferenceResult {
  const NsfwInferenceResult({
    required this.scores,
    required this.tripped,
  });

  final NsfwScores scores;

  /// True iff [scores.nsfwAggregate] is `>= [kClientSignalThreshold]`.
  final bool tripped;

  /// The safe sentinel (used when the classifier is disabled / unloaded /
  /// the frame can't be processed). Always `tripped = false`.
  static const NsfwInferenceResult safe = NsfwInferenceResult(
    scores: NsfwScores.safe,
    tripped: false,
  );
}

/// Scaffold-level classifier interface. Implementations MUST be safe to call
/// on every sampled frame and MUST NEVER throw — a single bad frame must not
/// be allowed to break a live call.
abstract class NsfwClassifier {
  /// Score one JPEG frame and return the per-class breakdown. Always returns
  /// [NsfwInferenceResult.safe] when the classifier is disabled / unloaded.
  Future<NsfwInferenceResult> classify(Uint8List frameJpeg);

  /// Best-effort release of any held interpreter / buffers.
  void dispose();
}

/// The no-op classifier — used when the asset is absent OR the env switch is
/// off. Every classify() returns SAFE. This is the SHIPPING DEFAULT.
class _NoopNsfwClassifier implements NsfwClassifier {
  const _NoopNsfwClassifier();

  @override
  Future<NsfwInferenceResult> classify(Uint8List frameJpeg) async =>
      NsfwInferenceResult.safe;

  @override
  void dispose() {}
}

/// Adapter that delegates to the live per-call backend in
/// `features/roulette/data/nsfw_classifier.dart` and re-projects its
/// [backend.ClassificationResult] back into the 5-class breakdown the
/// scaffold surface exposes.
///
/// We don't duplicate the TFLite interpreter — there's exactly one model load
/// per call session (owned by the backend) and one boot probe (owned by
/// [NsfwService.tryLoad]). The adapter is just a shim so callers outside the
/// call loop can score a frame against the same backend.
class _BackendNsfwClassifier implements NsfwClassifier {
  _BackendNsfwClassifier() : _delegate = backend.createNsfwClassifier();

  final backend.NsfwClassifier _delegate;

  @override
  Future<NsfwInferenceResult> classify(Uint8List frameJpeg) async {
    try {
      final raw = await _delegate.classify(frameJpeg);
      // The backend collapses 5 classes → a single (label, score) pair. Project
      // back into a NsfwScores so the aggregate gate can run uniformly.
      switch (raw.label.toString()) {
        case 'ModerationLabel.sexual':
          // backend's sexual = max(porn, hentai) — split equally is a safe
          // approximation since downstream only consumes the aggregate.
          final half = raw.score / 2;
          return NsfwInferenceResult(
            scores: NsfwScores(
              drawings: 0,
              hentai: half,
              neutral: 1 - raw.score,
              porn: half,
              sexy: 0,
            ),
            tripped: raw.score >= kClientSignalThreshold,
          );
        case 'ModerationLabel.nudity':
          return NsfwInferenceResult(
            scores: NsfwScores(
              drawings: 0,
              hentai: 0,
              neutral: 1 - raw.score,
              porn: 0,
              sexy: raw.score,
            ),
            tripped: raw.score >= kClientSignalThreshold,
          );
        default:
          return NsfwInferenceResult.safe;
      }
    } catch (_) {
      // Defensive: any backend hiccup degrades to SAFE.
      return NsfwInferenceResult.safe;
    }
  }

  @override
  void dispose() => _delegate.dispose();
}

/// The shipping default classifier (no-op). Replaced by [_BackendNsfwClassifier]
/// once [NsfwService.tryLoad] confirms the asset is loadable AND the env
/// switch is on.
const NsfwClassifier noopNsfwClassifier = _NoopNsfwClassifier();

/// Factory for the per-frame classifier. The service swaps this at boot when
/// the asset + env switch agree; everywhere else (including tests) can call
/// [buildNsfwClassifier] to get an instance honouring the current gate.
typedef NsfwClassifierFactory = NsfwClassifier Function();

NsfwClassifierFactory _factory = () => noopNsfwClassifier;

/// Override the classifier factory. Called by [NsfwService.tryLoad] on a
/// successful probe; tests can override to inject a fake.
@visibleForTesting
void setNsfwClassifierFactory(NsfwClassifierFactory factory) {
  _factory = factory;
}

/// Build a classifier honouring the current factory. Returns a no-op when the
/// service hasn't been loaded (or the asset is absent / env switch is off).
NsfwClassifier buildNsfwClassifier() => _factory();

/// The shared backend factory — installs the real adapter. Public so the
/// service can call it without exposing the internal type.
NsfwClassifier _backendClassifierFactory() => _BackendNsfwClassifier();

/// Internal: swap the factory to the real backend. Called by
/// [NsfwService.tryLoad] only.
void installBackendFactory() {
  _factory = _backendClassifierFactory;
}
