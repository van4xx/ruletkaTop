import 'dart:ui';

import 'package:flutter/material.dart';

import '../theme/theme.dart';

/// A frosted-glass surface — the app's signature container. A blurred,
/// translucent fill with a hairline border and optional neon [glowColor],
/// mirroring the web's glassmorphism cards over the dark "void".
///
/// Use it for cards, sheets, list rows and stat tiles. On light theme the fill
/// is a near-opaque white; on dark it's a subtle white wash over the backdrop.
class GlassCard extends StatelessWidget {
  const GlassCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.lg),
    this.borderRadius = AppRadii.brXl,
    this.onTap,
    this.glowColor,
    this.glowStrength = 1,
    this.blurSigma = 18,
    this.fillOpacity,
    this.border = true,
    this.margin,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry? margin;
  final BorderRadius borderRadius;
  final VoidCallback? onTap;

  /// When set, a soft neon bloom of this color sits behind the card.
  final Color? glowColor;
  final double glowStrength;

  /// Backdrop blur strength (logical px). Set to 0 to skip the (costly) blur.
  final double blurSigma;

  /// Override the glass fill opacity (0–1). Defaults to the theme's glassFill.
  final double? fillOpacity;

  /// Whether to draw the hairline border.
  final bool border;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final fill = fillOpacity != null
        ? colors.glassFill.withValues(alpha: fillOpacity)
        : colors.glassFill;

    Widget content = DecoratedBox(
      decoration: BoxDecoration(
        color: fill,
        borderRadius: borderRadius,
        border: border ? Border.all(color: colors.glassBorder, width: 1) : null,
      ),
      child: Padding(padding: padding, child: child),
    );

    if (blurSigma > 0) {
      content = ClipRRect(
        borderRadius: borderRadius,
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: blurSigma, sigmaY: blurSigma),
          child: content,
        ),
      );
    }

    if (onTap != null) {
      content = Material(
        color: Colors.transparent,
        borderRadius: borderRadius,
        child: InkWell(
          onTap: onTap,
          borderRadius: borderRadius,
          child: content,
        ),
      );
    }

    if (glowColor != null) {
      content = DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: borderRadius,
          boxShadow: AppShadows.glow(glowColor!, strength: glowStrength),
        ),
        child: content,
      );
    }

    if (margin != null) {
      content = Padding(padding: margin!, child: content);
    }

    return content;
  }
}
