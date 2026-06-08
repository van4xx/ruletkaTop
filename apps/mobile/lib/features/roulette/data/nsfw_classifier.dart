import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:image/image.dart' as img;
import 'package:tflite_flutter/tflite_flutter.dart';

import '../../../core/models/models.dart';

/// A normalized classification result in the contract's label space. Mirrors the
/// web `ClassificationResult` (`apps/web/src/features/moderation/classifier.ts`).
class ClassificationResult {
  const ClassificationResult({required this.label, required this.score});

  /// Mapped contract label (worst applicable category, or [ModerationLabel.safe]).
  final ModerationLabel label;

  /// Confidence of the winning unsafe category in [0,1] (0 when safe).
  final double score;

  /// A `safe` result used when screening is unavailable / the frame is clean.
  static const ClassificationResult safe =
      ClassificationResult(label: ModerationLabel.safe, score: 0);
}

/// The minimal on-device NSFW-classifier surface the call screening loop depends
/// on. Implementations MUST be safe to call on every sampled frame and MUST
/// NEVER throw — a single bad frame can never be allowed to break a live call.
///
/// This mirrors the web's swappable `NsfwClassifier` interface. The default
/// backend ([noopNsfwClassifier]) is a no-op that always returns `safe`, so
/// screening silently disables itself until a real model is wired in.
abstract class NsfwClassifier {
  /// Classify one decoded camera frame (JPEG bytes from
  /// `MediaStreamTrack.captureFrame()`). Resolves to a normalized result.
  Future<ClassificationResult> classify(Uint8List frameJpeg);

  /// Best-effort release of model/tensor resources.
  void dispose();
}

/// A classifier that always reports `safe` — used when no on-device model is
/// available (the shipping default). Screening becomes an inert pass-through:
/// the sampling loop still runs but never flags, exactly like the web's
/// graceful-degradation path when tfjs/nsfwjs fail to load.
class _NoopNsfwClassifier implements NsfwClassifier {
  const _NoopNsfwClassifier();

  @override
  Future<ClassificationResult> classify(Uint8List frameJpeg) async =>
      ClassificationResult.safe;

  @override
  void dispose() {}
}

/// The shipping default classifier (no-op — screening is gated off).
const NsfwClassifier noopNsfwClassifier = _NoopNsfwClassifier();

/// Factory for the classifier backend. Swap this once before a session starts to
/// drop in a real model without touching the call UI (tests, a TFLite model, a
/// server round-trip). Defaults to the no-op backend.
typedef NsfwClassifierFactory = NsfwClassifier Function();

NsfwClassifierFactory _factory = () => noopNsfwClassifier;

/// Override the classifier backend. See the TODO below for what a real backend
/// must provide.
void setNsfwClassifierFactory(NsfwClassifierFactory factory) {
  _factory = factory;
}

/// Construct a fresh classifier instance using the configured backend.
NsfwClassifier createNsfwClassifier() => _factory();

// ─────────────────────────────────────────────────────────────────────────────
// Real on-device backend: TFLite MobileNetV2 (mirrors the web's nsfwjs).
//
// The web client (apps/web/src/features/moderation/classifier.ts) runs nsfwjs
// (TensorFlow.js MobileNetV2) ENTIRELY on-device: frames never leave the phone
// for classification; only a downscaled EVIDENCE frame is POSTed to
// `/moderation/frame` AFTER a local violation trips. [TfliteNsfwClassifier]
// reaches parity by running the same gantman/nsfw_model MobileNetV2 converted to
// `.tflite`, on-device, with NO network + NO per-frame cost.
//
// The class→label mapping below MUST match the web EXACTLY so the two clients
// agree (see [_mapPredictions]).
// ─────────────────────────────────────────────────────────────────────────────

/// Asset path of the on-device NSFW model. An operator-provisioned binary (NOT
/// in the repo — see assets/models/README.md). When absent, the factory below
/// falls back to the no-op and screening stays inert.
const String kNsfwModelAsset = 'assets/models/nsfw.tflite';

/// MobileNetV2 input side (224×224 RGB) — the gantman/nsfw_model standard, the
/// same network the web's nsfwjs runs.
const int _kInputSide = 224;

/// The five raw classes the gantman/nsfw_model emits, in OUTPUT ORDER. The
/// converted `.tflite` MUST preserve this order (alphabetical, matching the
/// model's training labels). See assets/models/README.md.
///
/// NOTE: nsfwjs's web class names use `'Drawing'` (singular) while the upstream
/// model labels are `'Drawings'` (plural); only `Porn`/`Hentai`/`Sexy` drive the
/// mapping, so the drawings spelling is irrelevant to the contract label.
const List<String> _kClassOrder = <String>[
  'Drawings',
  'Hentai',
  'Neutral',
  'Porn',
  'Sexy',
];

/// Map the model's 5-class probabilities onto the contract's [ModerationLabel] —
/// a byte-for-byte port of the web's `mapPredictions`
/// (apps/web/src/features/moderation/classifier.ts):
///
///   • `Porn`/`Hentai` are the strongest "sexual content" signals → `sexual`.
///   • `Sexy` is "explicit but non-pornographic" → `nudity` (a softer category).
///   • `Drawings`/`Neutral` never win → the result is effectively safe.
///
/// We never infer `minor`/`violence` here — those come from other signals. The
/// local screening policy ([local_screening.dart]) then thresholds the winning
/// score (sexual ≥ 0.7, nudity ≥ 0.85), matching the web's policy.
ClassificationResult _mapPredictions(Map<String, double> raw) {
  final porn = raw['Porn'] ?? 0;
  final hentai = raw['Hentai'] ?? 0;
  final sexy = raw['Sexy'] ?? 0;

  // Strongest sexual signal first (mirrors web: `Math.max(porn, hentai)`).
  final sexual = porn > hentai ? porn : hentai;
  if (sexual >= sexy) {
    return ClassificationResult(label: ModerationLabel.sexual, score: sexual);
  }
  return ClassificationResult(label: ModerationLabel.nudity, score: sexy);
}

/// On-device NSFW classifier backed by a TFLite MobileNetV2. Lazy-loads one
/// [Interpreter] and reuses it (plus its input/output buffers) across every
/// sampled frame; [dispose] releases them.
///
/// Defensive by construction:
///   • [classify] NEVER throws — a decode/inference failure returns
///     [ClassificationResult.safe], so a single bad frame can't break the call.
///   • If the model asset is absent or fails to load, the FIRST classify logs
///     once and every subsequent call short-circuits to `safe` (no retry of the
///     heavy load). In practice the factory ([tfliteNsfwClassifierFactory] /
///     [installTfliteNsfwClassifier]) won't even install this backend unless the
///     asset is loadable, so this is a belt-and-suspenders second guard.
class TfliteNsfwClassifier implements NsfwClassifier {
  TfliteNsfwClassifier({String assetPath = kNsfwModelAsset})
      : _assetPath = assetPath;

  final String _assetPath;

  Interpreter? _interpreter;
  bool _loadAttempted = false;
  bool _loadFailed = false;
  bool _loggedFailure = false;

  /// Reusable input buffer: [1, 224, 224, 3] float32, filled per frame.
  late final List<List<List<List<double>>>> _input = List.generate(
    1,
    (_) => List.generate(
      _kInputSide,
      (_) => List.generate(
        _kInputSide,
        (_) => List<double>.filled(3, 0),
        growable: false,
      ),
      growable: false,
    ),
    growable: false,
  );

  /// Reusable output buffer: [1, 5] float32 (one row of class probabilities).
  late final List<List<double>> _output = List.generate(
    1,
    (_) => List<double>.filled(_kClassOrder.length, 0),
    growable: false,
  );

  Future<Interpreter?> _ensureInterpreter() async {
    if (_loadFailed) return null;
    if (_interpreter != null) return _interpreter;
    if (_loadAttempted) return _interpreter; // a load is settled (null = failed)
    _loadAttempted = true;
    try {
      _interpreter = await Interpreter.fromAsset(_assetPath);
      return _interpreter;
    } catch (e) {
      _loadFailed = true;
      _logFailureOnce('model asset failed to load ($_assetPath): $e');
      return null;
    }
  }

  void _logFailureOnce(String message) {
    if (_loggedFailure) return;
    _loggedFailure = true;
    if (kDebugMode) {
      debugPrint('[nsfw] $message — screening disabled (no-op fallback)');
    }
  }

  @override
  Future<ClassificationResult> classify(Uint8List frameJpeg) async {
    try {
      final interpreter = await _ensureInterpreter();
      if (interpreter == null) return ClassificationResult.safe;

      if (frameJpeg.isEmpty) return ClassificationResult.safe;

      // Decode the captured JPEG. `decodeJpg` returns null on a malformed/partial
      // frame (camera warming up) — treat that as safe rather than throwing.
      final decoded = img.decodeJpg(frameJpeg);
      if (decoded == null) return ClassificationResult.safe;

      // Resize to the model's 224×224 input (stretch — the web feeds the raw
      // video frame to nsfwjs which resizes internally the same way).
      final resized = decoded.width == _kInputSide && decoded.height == _kInputSide
          ? decoded
          : img.copyResize(decoded, width: _kInputSide, height: _kInputSide);

      // Fill the reusable input buffer with normalized RGB in [0,1] — the
      // gantman/nsfw_model preprocessing (MobileNetV2 trained on /255 inputs).
      for (var y = 0; y < _kInputSide; y++) {
        final row = _input[0][y];
        for (var x = 0; x < _kInputSide; x++) {
          final p = resized.getPixel(x, y);
          final px = row[x];
          px[0] = p.r / 255.0;
          px[1] = p.g / 255.0;
          px[2] = p.b / 255.0;
        }
      }

      interpreter.run(_input, _output);

      final probs = _normalize(_output[0]);
      final raw = <String, double>{};
      for (var i = 0; i < _kClassOrder.length; i++) {
        raw[_kClassOrder[i]] = probs[i];
      }
      return _mapPredictions(raw);
    } catch (_) {
      // A single frame failing must NEVER break the call loop (mirrors web).
      return ClassificationResult.safe;
    }
  }

  /// Return probabilities summing to 1. The gantman/nsfw_model graph already
  /// ends in a softmax (outputs are probabilities), so we only re-normalize as a
  /// cheap guard if the raw outputs look like logits (don't sum to ~1).
  List<double> _normalize(List<double> out) {
    var sum = 0.0;
    for (final v in out) {
      sum += v;
    }
    if (sum > 0.99 && sum < 1.01) return out; // already a probability vector
    if (sum <= 0) {
      // Degenerate output — apply a softmax so we never divide by zero.
      var maxV = double.negativeInfinity;
      for (final v in out) {
        if (v > maxV) maxV = v;
      }
      var expSum = 0.0;
      final exps = List<double>.filled(out.length, 0);
      for (var i = 0; i < out.length; i++) {
        final e = math.exp(out[i] - maxV);
        exps[i] = e;
        expSum += e;
      }
      if (expSum <= 0) return out;
      for (var i = 0; i < out.length; i++) {
        exps[i] = exps[i] / expSum;
      }
      return exps;
    }
    final norm = List<double>.filled(out.length, 0);
    for (var i = 0; i < out.length; i++) {
      norm[i] = out[i] / sum;
    }
    return norm;
  }

  @override
  void dispose() {
    try {
      _interpreter?.close();
    } catch (_) {
      /* best-effort */
    }
    _interpreter = null;
  }
}

/// A factory for the TFLite backend (one fresh classifier per call session, so
/// each session owns + disposes its own [Interpreter]). Used by
/// [installTfliteNsfwClassifier] once the asset is confirmed loadable.
NsfwClassifier tfliteNsfwClassifierFactory() => TfliteNsfwClassifier();

/// Activate the on-device TFLite NSFW backend — but ONLY when the model asset is
/// actually loadable, so we never falsely cut a clean user on a build that ships
/// without the (operator-provisioned) binary.
///
/// Call once at app start (see main.dart). The flow mirrors the web's graceful
/// degradation: probe the model once; on success, register
/// [tfliteNsfwClassifierFactory] so each future call session gets a real
/// classifier; on absence/failure, log once (debug) and leave the no-op default
/// untouched — the FULL screening pipeline still runs, it simply never flags.
///
/// Returns `true` iff the TFLite backend was activated. Never throws.
Future<bool> installTfliteNsfwClassifier({
  String assetPath = kNsfwModelAsset,
}) async {
  Interpreter? probe;
  try {
    probe = await Interpreter.fromAsset(assetPath);
  } catch (e) {
    if (kDebugMode) {
      debugPrint(
        '[nsfw] on-device model not available ($assetPath): $e — '
        'screening pipeline runs but never flags (no-op). Provision '
        'assets/models/nsfw.tflite to enable it (see assets/models/README.md).',
      );
    }
    return false;
  }
  // The probe only verifies loadability; the per-session classifiers create
  // their own interpreters, so release this one.
  try {
    probe.close();
  } catch (_) {
    /* best-effort */
  }
  setNsfwClassifierFactory(tfliteNsfwClassifierFactory);
  if (kDebugMode) {
    debugPrint('[nsfw] on-device TFLite classifier active ($assetPath)');
  }
  return true;
}
