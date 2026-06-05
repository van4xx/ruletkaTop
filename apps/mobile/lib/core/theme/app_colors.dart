import 'package:flutter/material.dart';

/// The ruletka.top palette, ported 1:1 from the web's OKLCH design tokens
/// (`apps/web/src/app/globals.css`) and converted to sRGB. Dark is the hero
/// theme: a deep violet-black "void" lit by an electric violet→cyan→magenta
/// neon accent system, with iOS-26-style **liquid glass** surfaces floating on
/// a soft neon aurora; light is the calmer daylight counterpart.
///
/// Do not hardcode colors in features — pull from `Theme.of(context)` or the
/// [AppColors] extension ([context.colors]) so theming stays centralized.
///
/// Every value below is the exact sRGB conversion of its OKLCH source (see the
/// `oklch(L C h)` comment), computed with the standard OKLab matrices.
abstract final class AppPalette {
  // ───────────────────────────── Dark (hero) ─────────────────────────────
  static const darkBackground = Color(0xFF0B0C16); // oklch(0.16 0.02 280)
  static const darkForeground = Color(0xFFF4F5FB); // oklch(0.97 0.008 280)
  static const darkCard = Color(0xFF161622); // oklch(0.205 0.024 285)
  static const darkPopover = Color(0xFF13121D); // oklch(0.19 0.022 285)
  static const darkPrimary = Color(0xFFAA6BFF); // oklch(0.68 0.24 296)
  static const darkPrimaryFg = Color(0xFF090715); // oklch(0.14 0.03 290)
  static const darkSecondary = Color(0xFF00D0EC); // oklch(0.78 0.15 210)
  static const darkSecondaryFg = Color(0xFF080811); // oklch(0.14 0.02 280)
  static const darkAccent = Color(0xFFFF62BE); // oklch(0.74 0.22 350)
  static const darkAccentFg = Color(0xFF12050B); // oklch(0.14 0.03 350)
  static const darkMuted = Color(0xFF23232E); // oklch(0.26 0.022 285)
  static const darkMutedFg = Color(0xFF9D9DAB); // oklch(0.7 0.02 285)
  static const darkDestructive = Color(0xFFF22A36); // oklch(0.62 0.23 25)
  static const darkSuccess = Color(0xFF2EC97A); // oklch(0.74 0.17 155)
  static const darkWarning = Color(0xFFFAB72A); // oklch(0.82 0.16 80)
  static const darkNeonViolet = Color(0xFFB368FF); // oklch(0.7 0.27 296)
  static const darkNeonCyan = Color(0xFF00E0F5); // oklch(0.82 0.16 205)
  static const darkNeonMagenta = Color(0xFFFF4AC1); // oklch(0.74 0.26 350)
  // Hairline borders / inputs are white at low alpha over the void.
  static const darkBorder = Color(0x1AFFFFFF); // white @ 10%
  static const darkInput = Color(0x24FFFFFF); // white @ ~14%

  // ──────────────────────────────── Light ────────────────────────────────
  static const lightBackground = Color(0xFFFAFAFB);
  static const lightForeground = Color(0xFF0B0C16);
  static const lightCard = Color(0xFFFFFFFF);
  static const lightPopover = Color(0xFFFFFFFF);
  static const lightPrimary = Color(0xFF8A4AF5);
  static const lightPrimaryFg = Color(0xFFFCFBFF);
  static const lightSecondary = Color(0xFF00B5DC);
  static const lightSecondaryFg = Color(0xFF0B0C16);
  static const lightAccent = Color(0xFFFC65B6);
  static const lightAccentFg = Color(0xFFFFF9FD);
  static const lightMuted = Color(0xFFF1F1F4);
  static const lightMutedFg = Color(0xFF61626F);
  static const lightDestructive = Color(0xFFDF202E);
  static const lightSuccess = Color(0xFF11BC6D);
  static const lightWarning = Color(0xFFF2A618);
  static const lightNeonViolet = Color(0xFF9850FF);
  static const lightNeonCyan = Color(0xFF00D1EF);
  static const lightNeonMagenta = Color(0xFFFF41B4);
  static const lightBorder = Color(0xFFDDDEE2);
  static const lightInput = Color(0xFFDDDEE2);
}

/// Brand colors that are independent of the active theme + the three signature
/// neon stops, exposed off `Theme.of(context).extension<AppColors>()`. This is
/// where features read glow/gradient/feedback colors that Material's
/// [ColorScheme] doesn't model — plus the full liquid-glass tint set.
@immutable
class AppColors extends ThemeExtension<AppColors> {
  const AppColors({
    required this.neonViolet,
    required this.neonCyan,
    required this.neonMagenta,
    required this.success,
    required this.warning,
    required this.glassFill,
    required this.glassFillStrong,
    required this.glassBorder,
    required this.glassHighlight,
    required this.glassInnerGlow,
    required this.scrim,
    required this.auroraViolet,
    required this.auroraCyan,
    required this.auroraMagenta,
  });

  /// Signature neon stops (used by gradients + glows).
  final Color neonViolet;
  final Color neonCyan;
  final Color neonMagenta;

  /// Feedback colors not represented by [ColorScheme].
  final Color success;
  final Color warning;

  /// Liquid-glass surface fill (translucent base) + a denser variant for
  /// surfaces that need more body (sheets, dialogs, the nav bar).
  final Color glassFill;
  final Color glassFillStrong;

  /// Hairline border + the soft specular highlight that runs along a glass
  /// panel's top edge, and the faint inner glow that pools at the bottom.
  final Color glassBorder;
  final Color glassHighlight;
  final Color glassInnerGlow;

  /// Modal/overlay scrim.
  final Color scrim;

  /// The three aurora blob tints painted behind every screen (already at the
  /// alpha they should be drawn at — feed them straight into a [RadialGradient]
  /// against transparent).
  final Color auroraViolet;
  final Color auroraCyan;
  final Color auroraMagenta;

  /// The signature 3-stop brand gradient (violet → cyan → magenta).
  List<Color> get brandGradient => [neonViolet, neonCyan, neonMagenta];

  /// A tighter violet→magenta gradient for primary CTAs.
  List<Color> get ctaGradient => [neonViolet, neonMagenta];

  /// The aurora blob tints as a list (violet → cyan → magenta), for callers
  /// that want to iterate the backdrop stops.
  List<Color> get auroraStops => [auroraViolet, auroraCyan, auroraMagenta];

  static const dark = AppColors(
    neonViolet: AppPalette.darkNeonViolet,
    neonCyan: AppPalette.darkNeonCyan,
    neonMagenta: AppPalette.darkNeonMagenta,
    success: AppPalette.darkSuccess,
    warning: AppPalette.darkWarning,
    // Liquid glass over the void: a clean frosted wash with a crisp lit rim.
    glassFill: Color(0x1FFFFFFF), // white @ ~12% (more body, less mud)
    glassFillStrong: Color(0x33FFFFFF), // white @ 20%
    glassBorder: Color(0x47FFFFFF), // white @ ~28% (crisp wet rim)
    glassHighlight: Color(0x99FFFFFF), // white @ 60% (bright top specular)
    glassInnerGlow: Color(0x1FB368FF), // neon-violet @ ~12% (inner bloom)
    scrim: Color(0xB3000000), // black @ 70%
    // Aurora blobs — vivid neon light so glass has rich color to refract.
    auroraViolet: Color(0x7AB368FF), // neon-violet @ ~48%
    auroraCyan: Color(0x4D00E0F5), // neon-cyan @ ~30%
    auroraMagenta: Color(0x66FF4AC1), // neon-magenta @ ~40%
  );

  static const light = AppColors(
    neonViolet: AppPalette.lightNeonViolet,
    neonCyan: AppPalette.lightNeonCyan,
    neonMagenta: AppPalette.lightNeonMagenta,
    success: AppPalette.lightSuccess,
    warning: AppPalette.lightWarning,
    glassFill: Color(0xCCFFFFFF), // white @ 80%
    glassFillStrong: Color(0xE6FFFFFF), // white @ 90%
    glassBorder: Color(0x14000000), // black @ 8%
    glassHighlight: Color(0xCCFFFFFF), // white @ 80%
    glassInnerGlow: Color(0x0F8A4AF5), // primary @ ~6%
    scrim: Color(0x66000000), // black @ 40%
    auroraViolet: Color(0x1F9850FF),
    auroraCyan: Color(0x1400D1EF),
    auroraMagenta: Color(0x1AFF41B4),
  );

  @override
  AppColors copyWith({
    Color? neonViolet,
    Color? neonCyan,
    Color? neonMagenta,
    Color? success,
    Color? warning,
    Color? glassFill,
    Color? glassFillStrong,
    Color? glassBorder,
    Color? glassHighlight,
    Color? glassInnerGlow,
    Color? scrim,
    Color? auroraViolet,
    Color? auroraCyan,
    Color? auroraMagenta,
  }) =>
      AppColors(
        neonViolet: neonViolet ?? this.neonViolet,
        neonCyan: neonCyan ?? this.neonCyan,
        neonMagenta: neonMagenta ?? this.neonMagenta,
        success: success ?? this.success,
        warning: warning ?? this.warning,
        glassFill: glassFill ?? this.glassFill,
        glassFillStrong: glassFillStrong ?? this.glassFillStrong,
        glassBorder: glassBorder ?? this.glassBorder,
        glassHighlight: glassHighlight ?? this.glassHighlight,
        glassInnerGlow: glassInnerGlow ?? this.glassInnerGlow,
        scrim: scrim ?? this.scrim,
        auroraViolet: auroraViolet ?? this.auroraViolet,
        auroraCyan: auroraCyan ?? this.auroraCyan,
        auroraMagenta: auroraMagenta ?? this.auroraMagenta,
      );

  @override
  AppColors lerp(ThemeExtension<AppColors>? other, double t) {
    if (other is! AppColors) return this;
    return AppColors(
      neonViolet: Color.lerp(neonViolet, other.neonViolet, t)!,
      neonCyan: Color.lerp(neonCyan, other.neonCyan, t)!,
      neonMagenta: Color.lerp(neonMagenta, other.neonMagenta, t)!,
      success: Color.lerp(success, other.success, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      glassFill: Color.lerp(glassFill, other.glassFill, t)!,
      glassFillStrong: Color.lerp(glassFillStrong, other.glassFillStrong, t)!,
      glassBorder: Color.lerp(glassBorder, other.glassBorder, t)!,
      glassHighlight: Color.lerp(glassHighlight, other.glassHighlight, t)!,
      glassInnerGlow: Color.lerp(glassInnerGlow, other.glassInnerGlow, t)!,
      scrim: Color.lerp(scrim, other.scrim, t)!,
      auroraViolet: Color.lerp(auroraViolet, other.auroraViolet, t)!,
      auroraCyan: Color.lerp(auroraCyan, other.auroraCyan, t)!,
      auroraMagenta: Color.lerp(auroraMagenta, other.auroraMagenta, t)!,
    );
  }
}

/// Ergonomic accessors so widgets read `context.colors.neonViolet` and
/// `context.scheme.primary` without verbose `Theme.of(context)` chains.
extension ThemeContextX on BuildContext {
  ColorScheme get scheme => Theme.of(this).colorScheme;
  AppColors get colors =>
      Theme.of(this).extension<AppColors>() ?? AppColors.dark;
  TextTheme get texts => Theme.of(this).textTheme;
  bool get isDark => Theme.of(this).brightness == Brightness.dark;
}
