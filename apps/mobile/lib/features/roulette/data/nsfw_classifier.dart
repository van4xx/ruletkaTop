import 'dart:typed_data';

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
// TODO(trust-and-safety): wire a REAL on-device NSFW model to mirror the web.
//
// The web client (apps/web/src/features/moderation/classifier.ts) runs nsfwjs
// (TensorFlow.js MobileNetV2) ENTIRELY on-device: frames never leave the phone
// for classification; only a downscaled EVIDENCE frame is POSTed to
// `/moderation/frame` AFTER a local violation trips. To reach parity on mobile,
// implement [NsfwClassifier] against one of:
//
//   • tflite_flutter (+ an NSFW MobileNet `.tflite` asset) — fully on-device,
//     no network, no per-call cost. Requires bundling the model (~3–5 MB) under
//     assets/ and adding the `tflite_flutter` dependency. This is the closest
//     match to the web behaviour.
//   • google_mlkit_image_labeling with a custom model — similar tradeoffs.
//   • A server round-trip that scores the captured JPEG (needs a moderation
//     inference endpoint + credentials; adds latency + per-frame cost).
//
// Whichever backend is chosen: map its raw classes onto [ModerationLabel] the
// same way the web does (Porn/Hentai → sexual, Sexy → nudity, else safe), then
// register it via [setNsfwClassifierFactory] at app start. Until then the no-op
// default keeps the FULL screening pipeline (sampling, local blur/cut, evidence
// reporting, server-driven `mod:action`) in place and correct — it simply never
// flags, so nothing is falsely cut.
// ─────────────────────────────────────────────────────────────────────────────
