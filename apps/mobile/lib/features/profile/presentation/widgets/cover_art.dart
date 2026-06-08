import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';

/// Renders a profile-cover cosmetic by its stable [coverId] as a self-contained
/// gradient band — the native analogue of the web's `ProfileCover` layer stack
/// (`apps/web/src/components/profile/cover-presets.tsx`). Each id maps to a
/// hand-built, on-brand gradient drawn from the neon brand tokens; an
/// unknown/null id falls back to `aurora` (the default) so the band is never
/// blank.
///
/// The caller owns the sizing/clipping container. Set [thumbnail] for the small
/// picker swatches (it slightly tightens the gradient stops for a denser read).
class CoverArt extends StatelessWidget {
  const CoverArt({
    super.key,
    required this.coverId,
    this.thumbnail = false,
  });

  final String coverId;
  final bool thumbnail;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    const gold = Color(0xFFE6B450);
    const emerald = Color(0xFF18C29C);
    const amber = Color(0xFFE0902E);
    final id = kCoverIds.contains(coverId) ? coverId : kDefaultCoverId;

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: _gradientFor(id, colors, gold, emerald, amber),
      ),
      // A subtle radial bloom + bottom fade gives every cover depth, like the
      // web band's central bloom + fade-into-panel.
      child: Stack(
        fit: StackFit.expand,
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: RadialGradient(
                center: const Alignment(0, -1),
                radius: 1.1,
                colors: [
                  Colors.white.withValues(alpha: thumbnail ? 0.06 : 0.10),
                  Colors.transparent,
                ],
              ),
            ),
          ),
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.bottomCenter,
                end: Alignment.center,
                colors: [
                  context.scheme.surface.withValues(alpha: 0.35),
                  Colors.transparent,
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Gradient _gradientFor(
    String id,
    dynamic colors,
    Color gold,
    Color emerald,
    Color amber,
  ) {
    final violet = colors.neonViolet as Color;
    final cyan = colors.neonCyan as Color;
    final magenta = colors.neonMagenta as Color;

    switch (id) {
      case 'graphite':
        return const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF2A2A38), Color(0xFF15151E)],
        );
      case 'sunset':
        return LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            magenta.withValues(alpha: 0.85),
            amber.withValues(alpha: 0.7),
            violet.withValues(alpha: 0.85),
          ],
          stops: const [0, 0.55, 1],
        );
      case 'mint':
        return LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [cyan, emerald],
        );
      case 'mesh':
        return LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [violet, magenta, cyan],
          stops: const [0, 0.5, 1],
        );
      case 'noir':
        return LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [const Color(0xFF1C1A16), gold.withValues(alpha: 0.85)],
          stops: const [0.55, 1],
        );
      case 'bubbles':
        return LinearGradient(
          begin: const Alignment(-0.8, -1),
          end: const Alignment(0.8, 1),
          colors: [magenta, Color.lerp(magenta, cyan, 0.5)!, cyan],
          stops: const [0, 0.5, 1],
        );
      case 'circuit':
        return LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [const Color(0xFF1A1B3A), cyan.withValues(alpha: 0.9)],
          stops: const [0.4, 1],
        );
      case 'galaxy':
        return RadialGradient(
          center: const Alignment(-0.4, -0.8),
          radius: 1.4,
          colors: [violet, const Color(0xFF120A2A)],
          stops: const [0, 0.85],
        );
      case 'prismatic':
        return SweepGradient(
          transform: const GradientRotation(-math.pi / 2),
          colors: [violet, cyan, emerald, amber, magenta, violet],
        );
      case 'aurora':
      default:
        return LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            violet.withValues(alpha: 0.85),
            magenta.withValues(alpha: 0.6),
            cyan.withValues(alpha: 0.75),
          ],
          stops: const [0, 0.5, 1],
        );
    }
  }
}
