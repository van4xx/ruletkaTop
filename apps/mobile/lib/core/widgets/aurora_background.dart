import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/theme.dart';

/// The app's signature atmospheric backdrop: the deep violet-black void lit by
/// three softly drifting neon "aurora" blobs (violet / cyan / magenta). Glass
/// panels float above it. This is the native counterpart to the web's rotating
/// aurora gradient.
///
/// Drop it at the base of a [Stack] (or use [AppScaffold], which wraps screens
/// in it automatically). On the light theme it renders a clean near-white wash
/// with whisper-faint tints so the same call site works in both themes.
///
/// Set [animate] to false (or honor the platform's reduce-motion setting, which
/// it does automatically) to paint a static aurora — same look, zero cost.
class AuroraBackground extends StatefulWidget {
  const AuroraBackground({
    super.key,
    this.child,
    this.animate = true,
    this.intensity = 1,
  });

  /// Content painted above the aurora (typically the screen body).
  final Widget? child;

  /// Drive the slow blob drift. Ignored when the OS requests reduced motion.
  final bool animate;

  /// Scales blob opacity/spread (0 = bare background, 1 = default ambience).
  final double intensity;

  @override
  State<AuroraBackground> createState() => _AuroraBackgroundState();
}

class _AuroraBackgroundState extends State<AuroraBackground>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: AppDurations.aurora,
  );

  @override
  void initState() {
    super.initState();
    _syncAnimation();
  }

  @override
  void didUpdateWidget(covariant AuroraBackground old) {
    super.didUpdateWidget(old);
    if (old.animate != widget.animate) _syncAnimation();
  }

  void _syncAnimation() {
    // Respect the platform reduce-motion accessibility flag.
    final reduceMotion =
        WidgetsBinding.instance.platformDispatcher.accessibilityFeatures.disableAnimations;
    if (widget.animate && !reduceMotion) {
      if (!_controller.isAnimating) _controller.repeat();
    } else {
      _controller.stop();
      _controller.value = 0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;

    final painter = RepaintBoundary(
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) => CustomPaint(
          painter: _AuroraPainter(
            t: _controller.value,
            base: scheme.surface,
            violet: colors.auroraViolet,
            cyan: colors.auroraCyan,
            magenta: colors.auroraMagenta,
            intensity: widget.intensity,
          ),
          isComplex: true,
          willChange: _controller.isAnimating,
          size: Size.infinite,
        ),
      ),
    );

    if (widget.child == null) return painter;
    return Stack(
      fit: StackFit.expand,
      children: [painter, widget.child!],
    );
  }
}

/// Paints the void base + three radial neon blobs whose centers drift along
/// gentle Lissajous paths, plus a faint vignette to settle the edges.
class _AuroraPainter extends CustomPainter {
  _AuroraPainter({
    required this.t,
    required this.base,
    required this.violet,
    required this.cyan,
    required this.magenta,
    required this.intensity,
  });

  /// Normalized animation phase (0–1).
  final double t;
  final Color base;
  final Color violet;
  final Color cyan;
  final Color magenta;
  final double intensity;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;

    // 1) The deep base fill.
    canvas.drawRect(rect, Paint()..color = base);

    final w = size.width;
    final h = size.height;
    final phase = t * 2 * math.pi;

    // 2) Three drifting blobs. Each: an anchor + a small orbit so the field
    //    breathes without ever looking busy. Radius scales with the diagonal.
    final diag = math.sqrt(w * w + h * h);

    void blob(
      Color color,
      double ax, // anchor x (0–1)
      double ay, // anchor y (0–1)
      double radiusFactor,
      double orbitX,
      double orbitY,
      double speed,
      double phaseOffset,
    ) {
      final cx = w * ax + math.cos(phase * speed + phaseOffset) * w * orbitX;
      final cy = h * ay + math.sin(phase * speed + phaseOffset) * h * orbitY;
      final radius = diag * radiusFactor;
      final center = Offset(cx, cy);
      final tinted = color.withValues(alpha: color.a * intensity.clamp(0.0, 1.5));
      final shader = RadialGradient(
        colors: [tinted, tinted.withValues(alpha: 0)],
        stops: const [0.0, 1.0],
      ).createShader(Rect.fromCircle(center: center, radius: radius));
      canvas.drawRect(rect, Paint()..shader = shader);
    }

    // Violet: anchored top-left, the dominant glow.
    blob(violet, 0.18, 0.12, 0.62, 0.05, 0.04, 1.0, 0.0);
    // Magenta: lower-right, warm counterweight.
    blob(magenta, 0.86, 0.74, 0.52, 0.06, 0.05, 0.8, 1.3);
    // Cyan: mid-right, cool accent that keeps the spectrum honest.
    blob(cyan, 0.74, 0.30, 0.46, 0.07, 0.05, 1.2, 2.6);

    // 3) A soft vignette so the corners fall into the void.
    final vignette = RadialGradient(
      center: Alignment.center,
      radius: 1.1,
      colors: [
        const Color(0x00000000),
        base.withValues(alpha: 0.55),
      ],
      stops: const [0.62, 1.0],
    ).createShader(rect);
    canvas.drawRect(rect, Paint()..shader = vignette);
  }

  @override
  bool shouldRepaint(_AuroraPainter old) =>
      old.t != t ||
      old.base != base ||
      old.violet != violet ||
      old.cyan != cyan ||
      old.magenta != magenta ||
      old.intensity != intensity;
}
