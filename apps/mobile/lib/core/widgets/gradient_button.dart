import 'package:flutter/material.dart';

import '../theme/theme.dart';

/// The app's signature call-to-action: a rounded button filled with the neon
/// violet→magenta gradient, lit by a soft glow and a glassy top sheen, with a
/// tactile press-scale. Supports a [loading] state (spinner, taps disabled), an
/// optional leading [icon], and a [fullWidth] layout.
///
/// For secondary/tertiary actions prefer the themed [OutlinedButton] /
/// [TextButton]; this is for the one primary action on a screen.
class GradientButton extends StatefulWidget {
  const GradientButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.loading = false,
    this.fullWidth = true,
    this.gradientColors,
    this.height = 54,
    this.borderRadius = AppRadii.brLg,
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
  State<GradientButton> createState() => _GradientButtonState();
}

class _GradientButtonState extends State<GradientButton> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final enabled = widget.onPressed != null && !widget.loading;
    final stops = widget.gradientColors ?? colors.ctaGradient;
    final br = widget.borderRadius;

    final gradient = LinearGradient(
      colors: enabled
          ? stops
          : stops.map((c) => c.withValues(alpha: 0.45)).toList(),
      begin: Alignment.centerLeft,
      end: Alignment.centerRight,
    );

    final content = widget.loading
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
              if (widget.icon != null) ...[
                Icon(widget.icon, size: 20, color: Colors.white),
                const SizedBox(width: AppSpacing.sm),
              ],
              Flexible(
                child: Text(
                  widget.label,
                  overflow: TextOverflow.ellipsis,
                  style: context.texts.labelLarge?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.2,
                  ),
                ),
              ),
            ],
          );

    return Opacity(
      opacity: enabled ? 1 : 0.85,
      child: AnimatedScale(
        scale: (_pressed && enabled) ? 0.97 : 1,
        duration: AppDurations.press,
        curve: AppCurves.glass,
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: br,
            boxShadow: (widget.glow && enabled)
                ? AppShadows.glow(stops.last, strength: _pressed ? 1.0 : 0.8)
                : null,
          ),
          child: Material(
            color: Colors.transparent,
            child: Ink(
              decoration: BoxDecoration(gradient: gradient, borderRadius: br),
              child: InkWell(
                onTap: enabled ? widget.onPressed : null,
                onHighlightChanged: (v) {
                  if (_pressed != v) setState(() => _pressed = v);
                },
                borderRadius: br,
                splashColor: Colors.white.withValues(alpha: 0.18),
                highlightColor: Colors.white.withValues(alpha: 0.08),
                child: Ink(
                  // A glassy top sheen over the gradient for depth.
                  decoration: BoxDecoration(
                    borderRadius: br,
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        Colors.white.withValues(alpha: 0.22),
                        Colors.white.withValues(alpha: 0),
                      ],
                      stops: const [0.0, 0.55],
                    ),
                  ),
                  child: Container(
                    height: widget.height,
                    width: widget.fullWidth ? double.infinity : null,
                    padding:
                        const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
                    alignment: Alignment.center,
                    child: content,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
