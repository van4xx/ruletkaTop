import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:image/image.dart' as img;

import '../../../core/models/models.dart';
import 'nsfw_classifier.dart';

// ── Conservative on-device screening policy (mirrors the web `policy.ts`) ─────
// Thresholds are deliberately HIGH to minimize false positives that would
// wrongly cut an innocent user's camera. The local classifier is a FIRST line
// of defense, not the judge: it (a) instantly cuts the local preview and (b)
// reports an evidence frame to the server, which owns the real escalation
// policy (warn → kick → ban) + human review.

/// Porn / Hentai — strong sexual content trips earliest.
const double _kThresholdSexual = 0.7;

/// Sexy — explicit but non-pornographic; a softer category.
const double _kThresholdNudity = 0.85;

/// How often we sample the local video for screening.
const Duration _kSampleInterval = Duration(seconds: 3);

/// After a violation, keep the preview blurred/cut at least this long before
/// re-evaluating, so a single trip doesn't flicker the camera on/off.
const Duration _kViolationCooldown = Duration(seconds: 8);

/// Minimum gap between evidence POSTs, so we don't spam the API on a bad stream.
const Duration _kReportMinGap = Duration(seconds: 5);

/// Longest edge (px) of the downscaled EVIDENCE frame — mirrors the web's
/// `MAX_EDGE` (apps/web/src/features/moderation/capture.ts). The raw captured
/// frame is full camera resolution; we shrink it so the POST body fits the
/// server's `/moderation/frame` evidence size cap.
const int _kEvidenceMaxEdge = 224;

/// JPEG quality for the downscaled evidence thumbnail — mirrors the web's
/// `EVIDENCE_QUALITY` (0.6 → image package's 0–100 scale).
const int _kEvidenceJpegQuality = 60;

/// Decide whether a classification result is a reportable violation under the
/// conservative thresholds. Returns null when the frame is acceptable.
ClassificationResult? _evaluate(ClassificationResult r) {
  if (r.label == ModerationLabel.sexual && r.score >= _kThresholdSexual) return r;
  if (r.label == ModerationLabel.nudity && r.score >= _kThresholdNudity) return r;
  return null;
}

/// A tripped violation (for optional UI / the host toast).
class ScreeningViolation {
  const ScreeningViolation({required this.label, required this.score, required this.at});

  final ModerationLabel label;
  final double score;
  final DateTime at;
}

/// On-device NSFW screening of the LOCAL camera during a video call — the Dart
/// port of the web `useLocalScreening` hook.
///
/// Given the live local [MediaStream], it samples the local video track every
/// [_kSampleInterval] (via `MediaStreamTrack.captureFrame()`), runs the frame
/// through the swappable [NsfwClassifier], and on a violation:
///   • flips [flagged] → true (the screen blurs/cuts the local preview AND, in
///     the call screen, disables the outbound video track so offending frames
///     never reach the peer),
///   • POSTs the violation + a JPEG evidence data-URL to `/moderation/frame`
///     (rate-limited), tagged with the current matchId + mapped label/score,
///   • fires [onViolation] once so the host can surface a gentle warning toast.
/// After a cooldown with clean frames, [flagged] clears so an accidental trip
/// self-heals.
///
/// Fully defensive: the classifier is lazy + swappable (no-op by default — see
/// [nsfw_classifier.dart]), every async step is guarded, and any failure
/// degrades to "screening off" — it NEVER throws into the call lifecycle.
///
/// A [ChangeNotifier] so the screen can `AnimatedBuilder`/listen on [flagged].
class LocalScreeningController extends ChangeNotifier {
  LocalScreeningController({required this.reportFrame});

  /// Best-effort evidence reporter, wired to `POST /moderation/frame`. Called
  /// rate-limited on a violation; must swallow its own errors.
  final Future<void> Function(ModerationViolationDto dto) reportFrame;

  NsfwClassifier? _classifier;
  Timer? _timer;
  bool _busy = false;
  bool _running = false;

  MediaStream? _stream;
  String? _matchId;
  void Function(ScreeningViolation v)? _onViolation;

  DateTime? _flaggedUntil;
  DateTime _lastReportAt = DateTime.fromMillisecondsSinceEpoch(0);

  bool _flagged = false;

  /// True while the local preview should be blurred/cut due to a recent
  /// violation. The call screen binds this to the local tile + outbound track.
  bool get flagged => _flagged;

  ScreeningViolation? _lastViolation;
  ScreeningViolation? get lastViolation => _lastViolation;

  /// True once screening is actively sampling (the model has been requested).
  bool get active => _running;

  /// Start (or reconfigure) screening for [stream] in match [matchId]. Screening
  /// only runs when [enabled] AND the stream carries a video track (voice calls
  /// have nothing to screen). Calling with a different stream re-binds; calling
  /// with `enabled: false` (or a null/audio-only stream) stops it.
  void update({
    required MediaStream? stream,
    required String? matchId,
    required bool enabled,
    void Function(ScreeningViolation v)? onViolation,
  }) {
    _matchId = matchId;
    _onViolation = onViolation;

    final hasVideo = (stream?.getVideoTracks().isNotEmpty) ?? false;
    final shouldRun = enabled && stream != null && hasVideo;

    if (!shouldRun) {
      _stop();
      return;
    }
    if (_running && identical(stream, _stream)) {
      return; // already screening this exact stream
    }
    _stop(); // re-bind to the new stream
    _stream = stream;
    _start();
  }

  void _start() {
    _running = true;
    _classifier = createNsfwClassifier();
    _flaggedUntil = null;
    _lastReportAt = DateTime.fromMillisecondsSinceEpoch(0);
    _timer = Timer.periodic(_kSampleInterval, (_) => unawaited(_tick()));
  }

  void _stop() {
    _timer?.cancel();
    _timer = null;
    _classifier?.dispose();
    _classifier = null;
    _stream = null;
    _busy = false;
    _flaggedUntil = null;
    final wasFlagged = _flagged;
    _flagged = false;
    _running = false;
    if (wasFlagged) notifyListeners();
  }

  /// One sample tick: capture → classify → enforce/report. Never throws.
  Future<void> _tick() async {
    if (_busy) return; // skip if a previous classify is still running
    final classifier = _classifier;
    final track = _stream?.getVideoTracks().firstOrNull;
    if (classifier == null || track == null) return;

    _busy = true;
    try {
      Uint8List frame;
      try {
        final buffer = await track.captureFrame();
        frame = buffer.asUint8List();
      } catch (_) {
        return; // frame not ready (camera warming up) / capture unsupported
      }
      if (frame.isEmpty) return;

      final result = await classifier.classify(frame);
      final violation = _evaluate(result);
      final now = DateTime.now();

      if (violation != null) {
        _flaggedUntil = now.add(_kViolationCooldown);
        final tripped = ScreeningViolation(
          label: violation.label,
          score: violation.score,
          at: now,
        );
        _lastViolation = tripped;
        if (!_flagged) {
          _flagged = true;
          notifyListeners();
        }
        _onViolation?.call(tripped);
        _report(violation, frame);
      } else if (_flaggedUntil != null && !now.isBefore(_flaggedUntil!)) {
        // Cooldown elapsed with a clean frame → self-heal.
        _flaggedUntil = null;
        if (_flagged) {
          _flagged = false;
          notifyListeners();
        }
      }
    } catch (_) {
      /* never throw out of the loop */
    } finally {
      _busy = false;
    }
  }

  /// Report a tripped violation to the server (rate-limited, best-effort).
  void _report(ClassificationResult result, Uint8List frameJpeg) {
    final now = DateTime.now();
    if (now.difference(_lastReportAt) < _kReportMinGap) return;
    _lastReportAt = now;

    // The captured frame is full camera resolution; DOWNSCALE it to a compact
    // thumbnail (longest edge ≤ 224px, JPEG q60) before building the data-URL,
    // mirroring the web evidence pipeline so the payload fits the server's
    // `/moderation/frame` size contract. A re-encode failure simply drops the
    // evidence (the violation is still reported, just without a frame).
    final evidence = _encodeEvidence(frameJpeg);

    unawaited(
      reportFrame(
        ModerationViolationDto(
          matchId: _matchId,
          label: result.label,
          score: result.score,
          evidence: evidence,
        ),
      ).catchError((Object e, StackTrace _) {
        // Best-effort, but DON'T silently swallow: a failing evidence upload is
        // a moderation gap worth surfacing in logs (mirrors the web reporter,
        // which logs the failure rather than dropping it on the floor).
        if (kDebugMode) {
          debugPrint('[screening] evidence report failed: $e');
        }
      }),
    );
  }

  /// Downscale [frameJpeg] (a full-size camera JPEG from `captureFrame()`) to a
  /// compact evidence data-URL — longest edge ≤ [_kEvidenceMaxEdge]px, re-encoded
  /// at [_kEvidenceJpegQuality]. Returns null when the frame can't be decoded /
  /// re-encoded, so the caller reports without evidence rather than shipping an
  /// oversized payload. Never throws.
  String? _encodeEvidence(Uint8List frameJpeg) {
    try {
      if (frameJpeg.isEmpty) return null;
      final decoded = img.decodeJpg(frameJpeg);
      if (decoded == null) return null;

      // Preserve aspect ratio: only shrink the longest edge down to the cap.
      final longest =
          decoded.width > decoded.height ? decoded.width : decoded.height;
      final resized = longest <= _kEvidenceMaxEdge
          ? decoded
          : (decoded.width >= decoded.height
              ? img.copyResize(decoded, width: _kEvidenceMaxEdge)
              : img.copyResize(decoded, height: _kEvidenceMaxEdge));

      final jpeg = img.encodeJpg(resized, quality: _kEvidenceJpegQuality);
      return 'data:image/jpeg;base64,${base64Encode(jpeg)}';
    } catch (_) {
      return null; // never throw out of the screening loop
    }
  }

  @override
  void dispose() {
    _stop();
    super.dispose();
  }
}
