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

/// Corner-radius scale derived from the web's `--radius: 0.875rem` (≈14px).
abstract final class AppRadii {
  static const double sm = 10;
  static const double md = 12;
  static const double lg = 14;
  static const double xl = 18;
  static const double xxl = 24;
  static const double pill = 999;

  static const BorderRadius brSm = BorderRadius.all(Radius.circular(sm));
  static const BorderRadius brMd = BorderRadius.all(Radius.circular(md));
  static const BorderRadius brLg = BorderRadius.all(Radius.circular(lg));
  static const BorderRadius brXl = BorderRadius.all(Radius.circular(xl));
  static const BorderRadius brXxl = BorderRadius.all(Radius.circular(xxl));
  static const BorderRadius brPill = BorderRadius.all(Radius.circular(pill));
}

/// Animation durations — snappy, with one signature longer beat for hero
/// transitions (matching the web's restrained motion language).
abstract final class AppDurations {
  static const Duration fast = Duration(milliseconds: 150);
  static const Duration normal = Duration(milliseconds: 250);
  static const Duration slow = Duration(milliseconds: 400);
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
