import 'dart:ui' show lerpDouble;

import 'package:flutter/material.dart';

import 'app_colors.dart';

/// Spacing scale (logical px). A small, consistent rhythm used for padding,
/// gaps and insets across the app. Mirrors the web's compact-but-airy feel.
abstract final class AppSpacing {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double xxl = 32;
  static const double xxxl = 48;

  static const EdgeInsets pageH = EdgeInsets.symmetric(horizontal: lg);
  static const EdgeInsets page = EdgeInsets.fromLTRB(lg, lg, lg, lg);
  static const EdgeInsets card = EdgeInsets.all(lg);
}

/// Corner-radius scale. The web's base `--radius` is ≈14px; the liquid-glass
/// language leans on softer, larger radii for hero surfaces (20–28) with pills
/// for chips/buttons.
abstract final class AppRadii {
  static const double sm = 10;
  static const double md = 12;
  static const double lg = 14;
  static const double xl = 18;
  static const double xxl = 24;
  static const double xxxl = 28;
  static const double pill = 999;

  static const BorderRadius brSm = BorderRadius.all(Radius.circular(sm));
  static const BorderRadius brMd = BorderRadius.all(Radius.circular(md));
  static const BorderRadius brLg = BorderRadius.all(Radius.circular(lg));
  static const BorderRadius brXl = BorderRadius.all(Radius.circular(xl));
  static const BorderRadius brXxl = BorderRadius.all(Radius.circular(xxl));
  static const BorderRadius brXxxl = BorderRadius.all(Radius.circular(xxxl));
  static const BorderRadius brPill = BorderRadius.all(Radius.circular(pill));
}

/// Backdrop-blur strengths (logical px sigma) for the glass system. The web
/// uses `blur(16px)`; native reads a touch heavier, so glass defaults to ~18.
abstract final class AppBlur {
  /// Subtle blur for inline chips / small rows.
  static const double subtle = 10;

  /// The signature glass-panel blur (cards, sheets).
  static const double glass = 18;

  /// Heavy blur for full-screen overlays / nav bars sitting on busy content.
  static const double heavy = 28;
}

/// Animation durations — snappy, with longer beats reserved for hero
/// transitions and the slowly drifting aurora backdrop.
abstract final class AppDurations {
  static const Duration fast = Duration(milliseconds: 150);
  static const Duration normal = Duration(milliseconds: 250);
  static const Duration slow = Duration(milliseconds: 400);

  /// The aurora backdrop's full drift cycle (very slow, ambient).
  static const Duration aurora = Duration(seconds: 24);

  /// A press/scale down-beat for tactile buttons.
  static const Duration press = Duration(milliseconds: 110);
}

/// Signature easing curves. [glass] is a soft, slightly overshooting ease used
/// for the press/hover feel; [enter] / [exit] are the asymmetric pair for
/// surfaces appearing and dismissing.
abstract final class AppCurves {
  static const Curve glass = Curves.easeOutCubic;
  static const Curve enter = Curves.easeOutBack;
  static const Curve exit = Curves.easeInCubic;
  static const Curve emphasized = Cubic(0.2, 0.0, 0.0, 1.0);
}

/// Neon glow + elevation helpers. The signature look is a soft colored bloom
/// behind interactive/branded surfaces rather than hard Material shadows.
abstract final class AppShadows {
  /// A soft neon bloom in [color]. [strength] scales opacity + blur (0–1+).
  static List<BoxShadow> glow(Color color, {double strength = 1}) => [
        BoxShadow(
          color: color.withValues(alpha: 0.45 * strength),
          blurRadius: 24 * strength,
          spreadRadius: -4,
        ),
        BoxShadow(
          color: color.withValues(alpha: 0.20 * strength),
          blurRadius: 48 * strength,
          spreadRadius: -8,
        ),
      ];

  /// A neutral lift for elevated cards on light surfaces.
  static const List<BoxShadow> card = [
    BoxShadow(color: Color(0x14000000), blurRadius: 16, offset: Offset(0, 6)),
  ];

  /// The ambient drop shadow under a floating glass panel — a deep, soft,
  /// near-black shadow that grounds the surface on the void without any tint.
  /// [strength] scales the whole stack (0 disables it).
  static List<BoxShadow> glass({double strength = 1}) {
    if (strength <= 0) return const [];
    return [
      BoxShadow(
        color: Colors.black.withValues(alpha: (0.25 * strength).clamp(0.0, 1.0)),
        blurRadius: 24 * strength,
        spreadRadius: -6,
        offset: Offset(0, 10 * strength),
      ),
      BoxShadow(
        color: Colors.black.withValues(alpha: (0.18 * strength).clamp(0.0, 1.0)),
        blurRadius: 6 * strength,
        offset: Offset(0, 2 * strength),
      ),
    ];
  }
}

/// The signature gradients, centralized so every surface speaks the same
/// neon-aurora language. These are theme-aware — call them with [AppColors]
/// read off `context.colors`.
abstract final class AppGradients {
  /// Primary CTA sweep (violet → magenta), left→right.
  static LinearGradient cta(AppColors c) => LinearGradient(
        colors: c.ctaGradient,
        begin: Alignment.centerLeft,
        end: Alignment.centerRight,
      );

  /// Full brand spectrum (violet → cyan → magenta), used for the wordmark and
  /// text shaders. Diagonal by default.
  static LinearGradient brand(
    AppColors c, {
    AlignmentGeometry begin = Alignment.topLeft,
    AlignmentGeometry end = Alignment.bottomRight,
  }) =>
      LinearGradient(colors: c.brandGradient, begin: begin, end: end);

  /// The translucent top-to-bottom sheen that fills a liquid-glass surface: a
  /// brighter wash up top fading to the base fill, giving the panel body.
  /// [intensity] (0–1+) scales how pronounced the sheen reads.
  static LinearGradient glassSheen(AppColors c, {double intensity = 1}) =>
      LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          Color.lerp(c.glassFill, c.glassHighlight,
              (0.14 * intensity).clamp(0.0, 1.0))!,
          c.glassFill,
          Color.lerp(c.glassFill, c.glassInnerGlow,
              (0.6 * intensity).clamp(0.0, 1.0))!,
        ],
        stops: const [0.0, 0.55, 1.0],
      );

  /// A single aurora blob as a soft radial that fades to transparent — used by
  /// the backdrop painter. [color] should already carry its target alpha.
  static RadialGradient auroraBlob(Color color) => RadialGradient(
        colors: [color, color.withValues(alpha: 0)],
        stops: const [0.0, 1.0],
      );
}

/// Convenience glow accessors keyed off the active theme's neon stops.
extension GlowX on BuildContext {
  List<BoxShadow> violetGlow({double strength = 1}) =>
      AppShadows.glow(colors.neonViolet, strength: strength);
  List<BoxShadow> cyanGlow({double strength = 1}) =>
      AppShadows.glow(colors.neonCyan, strength: strength);
  List<BoxShadow> magentaGlow({double strength = 1}) =>
      AppShadows.glow(colors.neonMagenta, strength: strength);
}

/// Internal helper kept for any future token math that needs a clamped lerp.
double lerpClamped(double a, double b, double t) =>
    lerpDouble(a, b, t.clamp(0.0, 1.0))!;
