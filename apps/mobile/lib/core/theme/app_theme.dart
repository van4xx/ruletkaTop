import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app_colors.dart';
import 'app_tokens.dart';
import 'app_typography.dart';

/// Central Material 3 theme for ruletka.top. Two [ThemeData]s — [dark] (the
/// hero) and [light] — built from the ported web palette, wired with the
/// Unbounded/Manrope type system and a glassmorphism-friendly component theme.
///
/// Consume via `MaterialApp.router(theme: AppTheme.light, darkTheme:
/// AppTheme.dark)`. Read brand/neon colors through `context.colors`.
abstract final class AppTheme {
  static ThemeData get dark => _build(Brightness.dark);
  static ThemeData get light => _build(Brightness.light);

  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;

    final scheme = isDark ? _darkScheme : _lightScheme;
    final ext = isDark ? AppColors.dark : AppColors.light;
    final textTheme = AppTypography.textTheme(brightness).apply(
      bodyColor: scheme.onSurface,
      displayColor: scheme.onSurface,
    );

    final overlayStyle = isDark
        ? SystemUiOverlayStyle.light.copyWith(
            statusBarColor: Colors.transparent,
            systemNavigationBarColor: scheme.surface,
            systemNavigationBarIconBrightness: Brightness.light,
          )
        : SystemUiOverlayStyle.dark.copyWith(
            statusBarColor: Colors.transparent,
            systemNavigationBarColor: scheme.surface,
            systemNavigationBarIconBrightness: Brightness.dark,
          );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      canvasColor: scheme.surface,
      textTheme: textTheme,
      extensions: [ext],
      splashFactory: InkSparkle.splashFactory,
      visualDensity: VisualDensity.adaptivePlatformDensity,

      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        systemOverlayStyle: overlayStyle,
        foregroundColor: scheme.onSurface,
        titleTextStyle: AppTypography.display(fontSize: 20, color: scheme.onSurface),
      ),

      cardTheme: CardThemeData(
        color: scheme.surfaceContainerHigh,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: const RoundedRectangleBorder(borderRadius: AppRadii.brXl),
      ),

      dividerTheme: DividerThemeData(
        color: scheme.outlineVariant,
        thickness: 1,
        space: 1,
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? AppPalette.darkInput : Colors.white,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.md),
        hintStyle: textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
        labelStyle: textTheme.labelLarge?.copyWith(color: scheme.onSurfaceVariant),
        border: OutlineInputBorder(
          borderRadius: AppRadii.brMd,
          borderSide: BorderSide(color: scheme.outline),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: AppRadii.brMd,
          borderSide: BorderSide(color: scheme.outline),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: AppRadii.brMd,
          borderSide: BorderSide(color: scheme.primary, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: AppRadii.brMd,
          borderSide: BorderSide(color: scheme.error),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: AppRadii.brMd,
          borderSide: BorderSide(color: scheme.error, width: 2),
        ),
      ),

      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(0, 52),
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
          shape: const RoundedRectangleBorder(borderRadius: AppRadii.brMd),
          textStyle: textTheme.labelLarge,
        ),
      ),

      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(0, 52),
          foregroundColor: scheme.onSurface,
          side: BorderSide(color: scheme.outline),
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
          shape: const RoundedRectangleBorder(borderRadius: AppRadii.brMd),
          textStyle: textTheme.labelLarge,
        ),
      ),

      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: scheme.primary,
          textStyle: textTheme.labelLarge,
        ),
      ),

      chipTheme: ChipThemeData(
        backgroundColor: scheme.surfaceContainerHighest,
        selectedColor: scheme.primary.withValues(alpha: 0.22),
        side: BorderSide(color: scheme.outline),
        labelStyle: textTheme.labelMedium ?? const TextStyle(),
        shape: const RoundedRectangleBorder(borderRadius: AppRadii.brPill),
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.xs),
      ),

      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: scheme.surface,
        selectedItemColor: scheme.primary,
        unselectedItemColor: scheme.onSurfaceVariant,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
        showUnselectedLabels: true,
      ),

      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: isDark ? AppPalette.darkPopover : Colors.white,
        surfaceTintColor: Colors.transparent,
        indicatorColor: scheme.primary.withValues(alpha: 0.18),
        elevation: 0,
        height: 68,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            color: selected ? scheme.primary : scheme.onSurfaceVariant,
            size: 24,
          );
        }),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return textTheme.labelSmall?.copyWith(
            color: selected ? scheme.primary : scheme.onSurfaceVariant,
          );
        }),
      ),

      dialogTheme: DialogThemeData(
        backgroundColor: scheme.surfaceContainerHigh,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(borderRadius: AppRadii.brXxl),
      ),

      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: scheme.surfaceContainerHigh,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadii.xxl)),
        ),
        showDragHandle: true,
      ),

      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: scheme.inverseSurface,
        contentTextStyle: textTheme.bodyMedium?.copyWith(color: scheme.onInverseSurface),
        shape: const RoundedRectangleBorder(borderRadius: AppRadii.brMd),
      ),

      progressIndicatorTheme: ProgressIndicatorThemeData(color: scheme.primary),

      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? scheme.onPrimary : scheme.onSurfaceVariant,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? scheme.primary : scheme.surfaceContainerHighest,
        ),
      ),

      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: scheme.inverseSurface,
          borderRadius: AppRadii.brSm,
        ),
        textStyle: textTheme.bodySmall?.copyWith(color: scheme.onInverseSurface),
      ),
    );
  }

  // ─────────────────────────── Color schemes ────────────────────────────
  static const ColorScheme _darkScheme = ColorScheme(
    brightness: Brightness.dark,
    primary: AppPalette.darkPrimary,
    onPrimary: AppPalette.darkPrimaryFg,
    primaryContainer: Color(0xFF3A1E66),
    onPrimaryContainer: Color(0xFFEADCFF),
    secondary: AppPalette.darkSecondary,
    onSecondary: AppPalette.darkSecondaryFg,
    secondaryContainer: Color(0xFF06384A),
    onSecondaryContainer: Color(0xFFCBF6FF),
    tertiary: AppPalette.darkAccent,
    onTertiary: AppPalette.darkAccentFg,
    tertiaryContainer: Color(0xFF5A1240),
    onTertiaryContainer: Color(0xFFFFD7EE),
    error: AppPalette.darkDestructive,
    onError: Color(0xFFFFFFFF),
    errorContainer: Color(0xFF5C1117),
    onErrorContainer: Color(0xFFFFD9DB),
    surface: AppPalette.darkBackground,
    onSurface: AppPalette.darkForeground,
    surfaceContainerLowest: Color(0xFF08090F),
    surfaceContainerLow: Color(0xFF111119),
    surfaceContainer: AppPalette.darkCard,
    surfaceContainerHigh: Color(0xFF1B1B28),
    surfaceContainerHighest: Color(0xFF222230),
    onSurfaceVariant: AppPalette.darkMutedFg,
    outline: AppPalette.darkBorder,
    outlineVariant: Color(0x14FFFFFF),
    inverseSurface: AppPalette.darkForeground,
    onInverseSurface: AppPalette.darkBackground,
    inversePrimary: AppPalette.lightPrimary,
    shadow: Color(0xFF000000),
    scrim: Color(0xFF000000),
    surfaceTint: AppPalette.darkPrimary,
  );

  static const ColorScheme _lightScheme = ColorScheme(
    brightness: Brightness.light,
    primary: AppPalette.lightPrimary,
    onPrimary: AppPalette.lightPrimaryFg,
    primaryContainer: Color(0xFFEADCFF),
    onPrimaryContainer: Color(0xFF24064F),
    secondary: AppPalette.lightSecondary,
    onSecondary: Color(0xFFFFFFFF),
    secondaryContainer: Color(0xFFC9F4FF),
    onSecondaryContainer: Color(0xFF002A36),
    tertiary: AppPalette.lightAccent,
    onTertiary: AppPalette.lightAccentFg,
    tertiaryContainer: Color(0xFFFFD7EE),
    onTertiaryContainer: Color(0xFF45052E),
    error: AppPalette.lightDestructive,
    onError: Color(0xFFFFFFFF),
    errorContainer: Color(0xFFFFDAD8),
    onErrorContainer: Color(0xFF410005),
    surface: AppPalette.lightBackground,
    onSurface: AppPalette.lightForeground,
    surfaceContainerLowest: Color(0xFFFFFFFF),
    surfaceContainerLow: Color(0xFFF6F6F8),
    surfaceContainer: Color(0xFFF1F1F4),
    surfaceContainerHigh: Color(0xFFFFFFFF),
    surfaceContainerHighest: Color(0xFFECECEF),
    onSurfaceVariant: AppPalette.lightMutedFg,
    outline: AppPalette.lightBorder,
    outlineVariant: Color(0xFFE7E7EB),
    inverseSurface: AppPalette.lightForeground,
    onInverseSurface: AppPalette.lightBackground,
    inversePrimary: AppPalette.darkPrimary,
    shadow: Color(0xFF000000),
    scrim: Color(0xFF000000),
    surfaceTint: AppPalette.lightPrimary,
  );
}
