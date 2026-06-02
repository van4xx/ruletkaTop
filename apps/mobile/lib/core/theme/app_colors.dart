import 'package:flutter/material.dart';

/// The ruletka.top palette, ported 1:1 from the web's OKLCH design tokens
/// (`apps/web/src/app/globals.css`) and converted to sRGB. Dark is the hero
/// theme: near-black "void" surfaces lit by an electric violet→cyan→magenta
/// neon accent system; light is the calmer daylight counterpart.
///
/// Do not hardcode colors in features — pull from `Theme.of(context)` or the
/// [AppColors] extension ([context.colors]) so theming stays centralized.
abstract final class AppPalette {
  // ───────────────────────────── Dark (hero) ─────────────────────────────
  static const darkBackground = Color(0xFF0B0C16);
  static const darkForeground = Color(0xFFF4F5FB);
  static const darkCard = Color(0xFF161622);
  static const darkPopover = Color(0xFF13121D);
  static const darkPrimary = Color(0xFFAA6BFF);
  static const darkPrimaryFg = Color(0xFF090715);
  static const darkSecondary = Color(0xFF00D0EC);
  static const darkSecondaryFg = Color(0xFF080811);
  static const darkAccent = Color(0xFFFF62BE);
  static const darkAccentFg = Color(0xFF12050B);
  static const darkMuted = Color(0xFF23232E);
  static const darkMutedFg = Color(0xFF9D9DAB);
  static const darkDestructive = Color(0xFFF22A36);
  static const darkSuccess = Color(0xFF2EC97A);
  static const darkWarning = Color(0xFFFAB72A);
  static const darkNeonViolet = Color(0xFFB368FF);
  static const darkNeonCyan = Color(0xFF00E0F5);
  static const darkNeonMagenta = Color(0xFFFF4AC1);
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
/// [ColorScheme] doesn't model.
@immutable
class AppColors extends ThemeExtension<AppColors> {
  const AppColors({
    required this.neonViolet,
    required this.neonCyan,
    required this.neonMagenta,
    required this.success,
    required this.warning,
    required this.glassFill,
    required this.glassBorder,
    required this.scrim,
  });

  /// Signature neon stops (used by gradients + glows).
  final Color neonViolet;
  final Color neonCyan;
  final Color neonMagenta;

  /// Feedback colors not represented by [ColorScheme].
  final Color success;
  final Color warning;

  /// Glassmorphism surface fill + hairline border (translucent).
  final Color glassFill;
  final Color glassBorder;

  /// Modal/overlay scrim.
  final Color scrim;

  /// The signature 3-stop brand gradient (violet → cyan → magenta).
  List<Color> get brandGradient => [neonViolet, neonCyan, neonMagenta];

  /// A tighter violet→magenta gradient for primary CTAs.
  List<Color> get ctaGradient => [neonViolet, neonMagenta];

  static const dark = AppColors(
    neonViolet: AppPalette.darkNeonViolet,
    neonCyan: AppPalette.darkNeonCyan,
    neonMagenta: AppPalette.darkNeonMagenta,
    success: AppPalette.darkSuccess,
    warning: AppPalette.darkWarning,
    glassFill: Color(0x14FFFFFF), // white @ 8%
    glassBorder: Color(0x1FFFFFFF), // white @ 12%
    scrim: Color(0xB3000000), // black @ 70%
  );

  static const light = AppColors(
    neonViolet: AppPalette.lightNeonViolet,
    neonCyan: AppPalette.lightNeonCyan,
    neonMagenta: AppPalette.lightNeonMagenta,
    success: AppPalette.lightSuccess,
    warning: AppPalette.lightWarning,
    glassFill: Color(0xCCFFFFFF), // white @ 80%
    glassBorder: Color(0x14000000), // black @ 8%
    scrim: Color(0x66000000), // black @ 40%
  );

  @override
  AppColors copyWith({
    Color? neonViolet,
    Color? neonCyan,
    Color? neonMagenta,
    Color? success,
    Color? warning,
    Color? glassFill,
    Color? glassBorder,
    Color? scrim,
  }) =>
      AppColors(
        neonViolet: neonViolet ?? this.neonViolet,
        neonCyan: neonCyan ?? this.neonCyan,
        neonMagenta: neonMagenta ?? this.neonMagenta,
        success: success ?? this.success,
        warning: warning ?? this.warning,
        glassFill: glassFill ?? this.glassFill,
        glassBorder: glassBorder ?? this.glassBorder,
        scrim: scrim ?? this.scrim,
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
      glassBorder: Color.lerp(glassBorder, other.glassBorder, t)!,
      scrim: Color.lerp(scrim, other.scrim, t)!,
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
