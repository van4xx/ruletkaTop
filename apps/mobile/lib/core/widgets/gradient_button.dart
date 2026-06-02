import 'package:flutter/material.dart';

import '../theme/theme.dart';

/// The app's signature call-to-action: a pill/rounded button filled with the
/// neon violet→magenta gradient and a soft glow. Supports a [loading] state
/// (shows a spinner, disables taps), an optional leading [icon], and a
/// [fullWidth] layout.
///
/// For secondary/tertiary actions prefer the themed [OutlinedButton] /
/// [TextButton]; this is for the one primary action on a screen.
class GradientButton extends StatelessWidget {
  const GradientButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.loading = false,
    this.fullWidth = true,
    this.gradientColors,
    this.height = 54,
    this.borderRadius = AppRadii.brMd,
    this.glow = true,
  });

  final String label;

  /// Tap handler. When `null` (or [loading]) the button renders disabled.
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool loading;
  final bool fullWidth;

  /// Override the gradient stops (defaults to the theme CTA violet→magenta).
  final List<Color>? gradientColors;
  final double height;
  final BorderRadius borderRadius;
  final bool glow;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final enabled = onPressed != null && !loading;
    final stops = gradientColors ?? colors.ctaGradient;

    final gradient = LinearGradient(
      colors: enabled
          ? stops
          : stops.map((c) => c.withValues(alpha: 0.45)).toList(),
      begin: Alignment.centerLeft,
      end: Alignment.centerRight,
    );

    return Opacity(
      opacity: enabled ? 1 : 0.85,
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: borderRadius,
          boxShadow: (glow && enabled)
              ? AppShadows.glow(stops.last, strength: 0.8)
              : null,
        ),
        child: Material(
          color: Colors.transparent,
          child: Ink(
            decoration: BoxDecoration(gradient: gradient, borderRadius: borderRadius),
            child: InkWell(
              onTap: enabled ? onPressed : null,
              borderRadius: borderRadius,
              child: Container(
                height: height,
                width: fullWidth ? double.infinity : null,
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
                alignment: Alignment.center,
                child: loading
                    ? const SizedBox(
                        height: 22,
                        width: 22,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.4,
                          valueColor: AlwaysStoppedAnimation(Colors.white),
                        ),
                      )
                    : Row(
                        mainAxisSize: MainAxisSize.min,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          if (icon != null) ...[
                            Icon(icon, size: 20, color: Colors.white),
                            const SizedBox(width: AppSpacing.sm),
                          ],
                          Flexible(
                            child: Text(
                              label,
                              overflow: TextOverflow.ellipsis,
                              style: context.texts.labelLarge?.copyWith(
                                color: Colors.white,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ],
                      ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
