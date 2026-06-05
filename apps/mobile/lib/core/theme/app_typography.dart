import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Type system mirroring the web: **Unbounded** for display/headings (a bold,
/// geometric display face — web `--font-display`) and **Manrope** for
/// body/labels (a clean grotesque — web `--font-sans`). Fonts are fetched +
/// cached at runtime by `google_fonts`, so nothing is bundled in the binary.
abstract final class AppTypography {
  /// Build the [TextTheme] for a given [brightness]. Manrope is the base for
  /// every slot; the display/headline slots are then overridden with Unbounded
  /// and tightened tracking for the neon, high-impact look.
  static TextTheme textTheme(Brightness brightness) {
    final base = ThemeData(brightness: brightness).textTheme;
    final body = GoogleFonts.manropeTextTheme(base);

    TextStyle display(double size,
            {double height = 1.05, FontWeight weight = FontWeight.w700}) =>
        GoogleFonts.unbounded(
          fontSize: size,
          height: height,
          fontWeight: weight,
          letterSpacing: -0.5,
        );

    return body.copyWith(
      displayLarge: display(48, height: 1.0, weight: FontWeight.w800),
      displayMedium: display(36),
      displaySmall: display(30),
      headlineLarge: display(26),
      headlineMedium: display(22),
      headlineSmall: display(19, weight: FontWeight.w600),
      // Titles use Manrope (semibold) for readability at smaller sizes.
      titleLarge: GoogleFonts.manrope(
          fontSize: 18, fontWeight: FontWeight.w700, letterSpacing: -0.2),
      titleMedium: GoogleFonts.manrope(
          fontSize: 16, fontWeight: FontWeight.w600, letterSpacing: -0.1),
      titleSmall:
          GoogleFonts.manrope(fontSize: 14, fontWeight: FontWeight.w600),
      bodyLarge: GoogleFonts.manrope(fontSize: 16, height: 1.45),
      bodyMedium: GoogleFonts.manrope(fontSize: 14, height: 1.45),
      bodySmall: GoogleFonts.manrope(fontSize: 12, height: 1.4),
      labelLarge: GoogleFonts.manrope(
          fontSize: 14, fontWeight: FontWeight.w600, letterSpacing: 0.2),
      labelMedium: GoogleFonts.manrope(
          fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 0.2),
      labelSmall: GoogleFonts.manrope(
          fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 0.4),
    );
  }

  /// A single Unbounded display style (for one-off hero text / the wordmark).
  static TextStyle display({
    double fontSize = 28,
    FontWeight fontWeight = FontWeight.w800,
    Color? color,
    double letterSpacing = -0.5,
    double? height,
  }) =>
      GoogleFonts.unbounded(
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
        letterSpacing: letterSpacing,
        height: height,
      );

  /// The "ruletka" wordmark style (Unbounded, tight tracking). Color is left
  /// null so callers can paint it with a [ShaderMask] brand gradient.
  static TextStyle wordmark({double fontSize = 22, Color? color}) =>
      GoogleFonts.unbounded(
        fontSize: fontSize,
        fontWeight: FontWeight.w800,
        letterSpacing: -1,
        color: color,
      );

  /// An eyebrow/overline label (Manrope, wide tracking, uppercase intent) for
  /// section kickers above headings.
  static TextStyle eyebrow({double fontSize = 11, Color? color}) =>
      GoogleFonts.manrope(
        fontSize: fontSize,
        fontWeight: FontWeight.w700,
        letterSpacing: 1.6,
        color: color,
      );

  /// A tabular-figures Manrope style for stat counters / balances so digits
  /// don't jitter as they change.
  static TextStyle stat({
    double fontSize = 22,
    FontWeight fontWeight = FontWeight.w800,
    Color? color,
  }) =>
      GoogleFonts.manrope(
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
        letterSpacing: -0.3,
        fontFeatures: const [FontFeature.tabularFigures()],
      );
}
