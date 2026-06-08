import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/theme.dart';

/// ruletka.top logo mark — a neon "roulette orbit".
///
/// A gradient wheel ring (with a roulette GAP) carries a bright ball/spark, with
/// a glowing gradient core and a faint inner ring for depth. It reads at once as
/// a spinning roulette wheel and as a connection orbit — the product in one
/// mark. The exact native twin of the web `Logo` (`apps/web/src/components/
/// brand/logo.tsx`): same geometry on a 48×48 grid, same three neon stops
/// (violet #B368FF → magenta #FF4AC1 → cyan #00E0F5), themed via [AppColors].
///
/// Decorative: always pair it with an accessible label on its parent.
class BrandLogo extends StatelessWidget {
  const BrandLogo({super.key, this.size = 36, this.glow = false});

  /// Edge length in logical px (the mark is square).
  final double size;

  /// Add a soft violet drop-glow behind the mark (used on hero/intro surfaces).
  final bool glow;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final mark = CustomPaint(
      size: Size.square(size),
      painter: _RouletteOrbitPainter(
        violet: colors.neonViolet,
        magenta: colors.neonMagenta,
        cyan: colors.neonCyan,
      ),
    );
    if (!glow) return mark;
    return DecoratedBox(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        boxShadow: AppShadows.glow(colors.neonViolet, strength: 0.9),
      ),
      child: mark,
    );
  }
}

/// Paints the roulette-orbit mark on a 48×48 reference grid, scaled to the
/// canvas. Mirrors the web SVG's layers, in back-to-front order:
///   1. faint inner cyan ring (depth);
///   2. outer gradient wheel ring with a roulette gap (an arc, not a full ring);
///   3. the cyan ball/spark riding the ring at top, with a soft halo;
///   4. the glowing gradient core.
class _RouletteOrbitPainter extends CustomPainter {
  _RouletteOrbitPainter({
    required this.violet,
    required this.magenta,
    required this.cyan,
  });

  final Color violet;
  final Color magenta;
  final Color cyan;

  @override
  void paint(Canvas canvas, Size size) {
    // Everything below is authored on a 48-unit grid (matching the web
    // viewBox), then uniformly scaled to the actual size.
    final s = size.width / 48.0;
    Offset p(double x, double y) => Offset(x * s, y * s);
    double u(double v) => v * s;

    final center = p(24, 24);

    // The diagonal brand gradient (violet → magenta → cyan), matching the web's
    // linearGradient from (7,6) → (41,42).
    final gradient = LinearGradient(
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
      colors: [violet, magenta, cyan],
      stops: const [0.0, 0.52, 1.0],
    ).createShader(Rect.fromPoints(p(7, 6), p(41, 42)));

    // 1) Faint inner ring — depth (cyan @ ~32%, r=10.5, stroke 1.4).
    canvas.drawCircle(
      center,
      u(10.5),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = u(1.4)
        ..color = cyan.withValues(alpha: 0.32),
    );

    // 2) Outer wheel ring with a roulette gap. The web uses strokeDasharray
    // "84 29" on a circumference of 2π·18 ≈ 113.1, i.e. an 84-long dash + a
    // 29-long gap, rotated -108°. We draw the matching arc: sweep = dash, with
    // the gap left open, rounded caps.
    final circumference = 2 * math.pi * 18;
    const dash = 84.0;
    final sweep = (dash / circumference) * 2 * math.pi; // dash as an angle
    final startAngle = _deg(-108);
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: u(18)),
      startAngle,
      sweep,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = u(3.6)
        ..strokeCap = StrokeCap.round
        ..shader = gradient,
    );

    // 3) The ball / spark riding the ring (top), with a soft halo.
    canvas.drawCircle(p(24, 6), u(6), Paint()..color = cyan.withValues(alpha: 0.22));
    canvas.drawCircle(p(24, 6), u(3.3), Paint()..color = cyan);

    // 4) Glowing gradient core.
    canvas.drawCircle(center, u(3.1), Paint()..shader = gradient);
  }

  double _deg(double degrees) => degrees * math.pi / 180.0;

  @override
  bool shouldRepaint(_RouletteOrbitPainter old) =>
      old.violet != violet || old.magenta != magenta || old.cyan != cyan;
}
