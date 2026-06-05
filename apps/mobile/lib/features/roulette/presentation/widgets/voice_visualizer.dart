import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';

/// Accent tone for the visualizer: peer (violet→magenta) vs local (cyan→violet).
enum VisualizerTone { peer, local }

/// The voice-roulette **Aurora Orb** — the Dart counterpart of the web
/// `VoiceOrb`. A large breathing sphere of light: a slowly-rotating conic
/// neon-aurora gradient with a glassy inner highlight + a darkened lower rim
/// (planet-like sphericity), a soft bloom blurred behind it, and a radial
/// frequency corona of neon spokes radiating from the rim. The peer's avatar
/// sits recessed at the orb's centre so the orb reads as an aura around them.
///
/// flutter_webrtc on mobile does not expose a Web-Audio analyser, so rather than
/// fake precise FFT data we drive a lively, organic motion from a single
/// animation clock seeded per-band (exactly as the old equalizer did). The
/// [active] flag (derived from track liveness / mute) modulates amplitude +
/// bloom so a muted/absent stream visibly calms down.
///
/// [compact] renders the tiny local "moon" companion: a small cyan orb with a
/// short equalizer beneath it (used for the bottom-right self-tile), no
/// avatar/label chrome.
class VoiceVisualizer extends StatefulWidget {
  const VoiceVisualizer({
    super.key,
    required this.name,
    this.avatarUrl,
    this.subtitle,
    this.tone = VisualizerTone.peer,
    this.active = true,
    this.compact = false,
  });

  final String name;
  final String? avatarUrl;
  final String? subtitle;
  final VisualizerTone tone;

  /// Whether audio is presumed flowing (drives amplitude + bloom + ring).
  final bool active;

  /// Compact variant for the local self-tile (the "moon").
  final bool compact;

  @override
  State<VoiceVisualizer> createState() => _VoiceVisualizerState();
}

class _VoiceVisualizerState extends State<VoiceVisualizer>
    with SingleTickerProviderStateMixin {
  late final AnimationController _clock;
  late List<double> _phases;

  int get _bands => widget.compact ? 18 : 32;

  bool get _reduceMotion => WidgetsBinding
      .instance
      .platformDispatcher
      .accessibilityFeatures
      .disableAnimations;

  @override
  void initState() {
    super.initState();
    _seedPhases();
    _clock = AnimationController(
      vsync: this,
      // Long cycle → the corona + breathing read as smooth, never frantic.
      duration: const Duration(seconds: 12),
    );
    if (!_reduceMotion) _clock.repeat();
  }

  void _seedPhases() {
    final rng = math.Random(widget.name.hashCode);
    _phases = List<double>.generate(
      _bands,
      (_) => rng.nextDouble() * math.pi * 2,
    );
  }

  @override
  void didUpdateWidget(covariant VoiceVisualizer old) {
    super.didUpdateWidget(old);
    if (old.name != widget.name || old.compact != widget.compact) _seedPhases();
  }

  @override
  void dispose() {
    _clock.dispose();
    super.dispose();
  }

  /// A synthesized loudness envelope (0..1) standing in for the web's mic level.
  /// Two slow summed sines give an organic "breathing" rise/fall; calmed right
  /// down when [active] is false (muted / no stream).
  double _energy(double t) {
    if (!widget.active) return 0.06;
    final a = 0.5 + 0.5 * math.sin(t * math.pi * 2);
    final b = 0.5 + 0.5 * math.sin(t * math.pi * 2 * 2.7 + 1.1);
    return (a * 0.65 + b * 0.35).clamp(0.0, 1.0);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final peer = widget.tone == VisualizerTone.peer;
    final coronaStops = peer
        ? [colors.neonViolet, colors.neonMagenta, colors.neonCyan]
        : [colors.neonCyan, colors.neonViolet];
    final bloomColor = peer ? colors.neonMagenta : colors.neonCyan;
    final orbStops = peer
        ? [
            colors.neonViolet,
            colors.neonMagenta,
            colors.neonCyan,
            colors.neonViolet,
          ]
        : [colors.neonCyan, colors.neonViolet, colors.neonCyan];

    final orbBox = widget.compact ? 56.0 : 220.0;

    final orb = SizedBox(
      width: orbBox,
      height: orbBox,
      child: AnimatedBuilder(
        animation: _clock,
        builder: (context, child) {
          final t = _clock.value;
          final level = _energy(t);
          // Spin is one full turn per cycle; corona phase rides the same clock.
          final spin = _reduceMotion ? 0.0 : t * 2 * math.pi;
          return CustomPaint(
            painter: _AuroraOrbPainter(
              spin: spin,
              t: t,
              level: _reduceMotion ? 0.22 : level,
              phases: _phases,
              orbStops: orbStops,
              coronaStops: coronaStops,
              bloomColor: bloomColor,
              compact: widget.compact,
              reduceMotion: _reduceMotion,
            ),
            child: child,
          );
        },
        // The recessed avatar at the orb's centre (peer/full orb only).
        child: widget.compact
            ? const SizedBox.shrink()
            : Center(
                child: DecoratedBox(
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: Color(0x99000000),
                        blurRadius: 18,
                        spreadRadius: -2,
                        offset: Offset(0, 2),
                      ),
                    ],
                  ),
                  child: NeonAvatar(
                    imageUrl: widget.avatarUrl,
                    name: widget.name,
                    size: orbBox * 0.56,
                    glow: false,
                  ),
                ),
              ),
      ),
    );

    if (widget.compact) {
      // The local "moon": a small orb + a short equalizer underneath.
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          orb,
          const SizedBox(height: AppSpacing.sm),
          SizedBox(
            width: 128,
            height: 30,
            child: AnimatedBuilder(
              animation: _clock,
              builder: (context, _) => CustomPaint(
                painter: _EqualizerPainter(
                  t: _clock.value,
                  phases: _phases,
                  gradient: coronaStops,
                  amplitude: widget.active ? 1 : 0.16,
                  compact: true,
                ),
              ),
            ),
          ),
        ],
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        orb,
        const SizedBox(height: AppSpacing.xl),
        // Centred "now-playing" identity beneath the orb.
        Text(
          widget.name,
          textAlign: TextAlign.center,
          style: AppTypography.display(
            fontSize: 22,
            color: context.scheme.onSurface,
          ),
        ),
        if (widget.subtitle != null) ...[
          const SizedBox(height: 4),
          Text(
            widget.subtitle!,
            textAlign: TextAlign.center,
            style: context.texts.bodyMedium?.copyWith(
              color: context.scheme.onSurfaceVariant,
            ),
          ),
        ],
      ],
    );
  }
}

/// Paints the full Aurora Orb: outer bloom → conic-aurora sphere body → glassy
/// inner highlight + dark lower rim → radial frequency corona. The supplied
/// child (the recessed avatar) is composited on top by the host [CustomPaint].
class _AuroraOrbPainter extends CustomPainter {
  _AuroraOrbPainter({
    required this.spin,
    required this.t,
    required this.level,
    required this.phases,
    required this.orbStops,
    required this.coronaStops,
    required this.bloomColor,
    required this.compact,
    required this.reduceMotion,
  });

  final double spin;
  final double t;
  final double level;
  final List<double> phases;
  final List<Color> orbStops;
  final List<Color> coronaStops;
  final Color bloomColor;
  final bool compact;
  final bool reduceMotion;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    final center = Offset(w / 2, h / 2);
    // Breathing: the whole orb body inflates a touch on loud passages.
    final orbR = math.min(w, h) * 0.5 * (0.86 + level * 0.06);

    // ── 1) Outer bloom — a soft radial that inflates + brightens with level.
    final bloomR = orbR * (1.18 + level * 0.4);
    final bloomPaint = Paint()
      ..shader = ui.Gradient.radial(
        center,
        bloomR,
        [
          bloomColor.withValues(alpha: (0.32 + level * 0.34).clamp(0.0, 1.0)),
          bloomColor.withValues(alpha: 0),
        ],
        const [0.0, 1.0],
      )
      ..maskFilter = MaskFilter.blur(BlurStyle.normal, compact ? 8 : 22);
    canvas.drawCircle(center, bloomR, bloomPaint);

    // ── 2) The orb body — a rotating conic (sweep) aurora gradient.
    final orbRect = Rect.fromCircle(center: center, radius: orbR);
    final sweep = SweepGradient(
      transform: GradientRotation(spin),
      colors: orbStops,
    ).createShader(orbRect);
    canvas.drawCircle(center, orbR, Paint()..shader = sweep);

    // ── 3a) Glassy inner highlight (upper-left) → planet-like sphericity.
    final hi = Offset(center.dx - orbR * 0.32, center.dy - orbR * 0.42);
    final highlight = Paint()
      ..shader = ui.Gradient.radial(
        hi,
        orbR * 0.95,
        [
          Colors.white.withValues(alpha: 0.55),
          Colors.white.withValues(alpha: 0.08),
          Colors.white.withValues(alpha: 0),
        ],
        const [0.0, 0.4, 0.62],
      );
    canvas.drawCircle(center, orbR, highlight);

    // ── 3b) Darken the lower-right rim so it reads as a lit sphere.
    final lo = Offset(center.dx + orbR * 0.34, center.dy + orbR * 0.5);
    final shade = Paint()
      ..shader = ui.Gradient.radial(
        lo,
        orbR * 0.9,
        [
          Colors.black.withValues(alpha: 0.5),
          Colors.black.withValues(alpha: 0),
        ],
        const [0.0, 0.62],
      );
    canvas.drawCircle(center, orbR, shade);

    // A faint inner vignette to pool the very centre (behind the avatar).
    final innerShade = Paint()
      ..shader = ui.Gradient.radial(
        center,
        orbR,
        [
          Colors.black.withValues(alpha: 0),
          Colors.black.withValues(alpha: 0.42),
        ],
        const [0.55, 1.0],
      );
    canvas.drawCircle(center, orbR, innerShade);

    // ── 4) Radial frequency corona — neon spokes radiating from the rim.
    final n = phases.length;
    final spokes = n * 2;
    final baseR = orbR * 1.0;
    final amp = math.min(w, h) * (compact ? 0.12 : 0.16);
    final coronaShader = ui.Gradient.linear(
      Offset(0, 0),
      Offset(w, h),
      coronaStops,
      _evenStops(coronaStops.length),
    );
    final spokePaint = Paint()
      ..shader = coronaShader
      ..strokeCap = StrokeCap.round
      ..strokeWidth = compact
          ? 2.0
          : math.max(2.0, (2 * math.pi * baseR) / n / 2.4);

    for (var s = 0; s < spokes; s++) {
      final idx = s < n ? s : spokes - 1 - s;
      // Two summed sines per band → lively, non-repetitive ripple.
      final a = math.sin(t * math.pi * 2 + phases[idx]);
      final b = math.sin(t * math.pi * 4 + phases[idx] * 1.7);
      final raw = ((a * 0.6 + b * 0.4) * 0.5 + 0.5);
      final v = reduceMotion ? 0.2 : raw * (0.35 + level * 0.85);
      final len = v * v * amp;
      if (len < 0.5 && !reduceMotion) continue;
      final ang = (s / spokes) * math.pi * 2 - math.pi / 2;
      final cos = math.cos(ang);
      final sin = math.sin(ang);
      final r0 = baseR;
      final r1 = baseR + len + (reduceMotion ? amp * 0.18 : 0);
      spokePaint.color = spokePaint.color.withValues(
        alpha: (reduceMotion ? 0.32 : 0.4 + math.min(0.5, v * 1.2)),
      );
      canvas.drawLine(
        center + Offset(cos * r0, sin * r0),
        center + Offset(cos * r1, sin * r1),
        spokePaint,
      );
    }
  }

  /// Evenly distributed stops for an N-color gradient.
  List<double> _evenStops(int count) {
    if (count <= 1) return const [0.0];
    return List<double>.generate(count, (i) => i / (count - 1));
  }

  @override
  bool shouldRepaint(_AuroraOrbPainter old) =>
      old.spin != spin || old.t != t || old.level != level;
}

/// A mirrored neon equalizer — kept for the compact local "moon" companion.
class _EqualizerPainter extends CustomPainter {
  _EqualizerPainter({
    required this.t,
    required this.phases,
    required this.gradient,
    required this.amplitude,
    required this.compact,
  });

  final double t;
  final List<double> phases;
  final List<Color> gradient;
  final double amplitude;
  final bool compact;

  @override
  void paint(Canvas canvas, Size size) {
    final n = phases.length;
    final gap = compact ? 3.0 : 5.0;
    final barW = (size.width - gap * (n - 1)) / n;
    final midY = size.height / 2;
    final minH = compact ? 4.0 : 6.0;
    final radius = math.min(barW / 2, 4.0);

    final paint = Paint()
      ..shader = LinearGradient(
        colors: gradient,
      ).createShader(Rect.fromLTWH(0, 0, size.width, size.height));

    for (var i = 0; i < n; i++) {
      final a = math.sin(t * math.pi * 2 + phases[i]);
      final b = math.sin(t * math.pi * 4 + phases[i] * 1.7);
      final v = ((a * 0.6 + b * 0.4) * 0.5 + 0.5) * amplitude;
      final barH = math.max(minH, v * v * size.height * 0.92);
      final x = i * (barW + gap);
      final rect = RRect.fromRectAndRadius(
        Rect.fromLTWH(x, midY - barH / 2, barW, barH),
        Radius.circular(radius),
      );
      canvas.drawRRect(rect, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _EqualizerPainter old) =>
      old.t != t || old.amplitude != amplitude;
}
