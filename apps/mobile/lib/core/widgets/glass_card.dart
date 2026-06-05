import 'dart:ui';

import 'package:flutter/material.dart';

import '../theme/theme.dart';

/// A **liquid-glass** surface — the app's signature container. Layers a real
/// [BackdropFilter] blur, a translucent top-to-bottom sheen, a hairline border,
/// a soft specular highlight along the top edge, a faint inner glow pooling at
/// the bottom, an ambient grounding shadow, and an optional neon [glowColor]
/// bloom. Mirrors the web's frosted-glass cards over the deep violet void, but
/// elevated to an iOS-26-style fluid material.
///
/// Use it for cards, sheets, list rows and stat tiles. On light theme the fill
/// is a near-opaque white; on dark it's a cool translucent wash over the
/// aurora backdrop.
///
/// Performance: pass `blurSigma: 0` to skip the (costly) [BackdropFilter] for
/// items in long scrolling lists — the sheen, border, highlight and glow all
/// still render, so the surface keeps its look without the live blur.
class GlassCard extends StatefulWidget {
  const GlassCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.lg),
    this.borderRadius = AppRadii.brXl,
    this.onTap,
    this.onLongPress,
    this.glowColor,
    this.glowStrength = 1,
    this.blurSigma = AppBlur.glass,
    this.fillOpacity,
    this.intensity = 1,
    this.border = true,
    this.highlight = true,
    this.shadow = true,
    this.margin,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry? margin;
  final BorderRadius borderRadius;

  /// Tap handler. When set, the card becomes pressable with a subtle scale +
  /// ripple. Long-press is also supported via [onLongPress].
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  /// When set, a soft neon bloom of this color sits behind the card.
  final Color? glowColor;
  final double glowStrength;

  /// Backdrop blur strength (logical px). Set to 0 to skip the (costly) blur.
  final double blurSigma;

  /// Override the glass fill opacity (0–1). When set, replaces the theme's
  /// translucent sheen with a flat fill at this opacity (kept for callers that
  /// relied on the original behavior).
  final double? fillOpacity;

  /// Scales how pronounced the liquid-glass treatment reads (sheen + highlight
  /// + inner glow). 1 is the default; lower for flatter rows, higher for hero
  /// panels.
  final double intensity;

  /// Whether to draw the hairline border.
  final bool border;

  /// Whether to draw the top specular highlight line.
  final bool highlight;

  /// Whether to drop the ambient grounding shadow beneath the panel.
  final bool shadow;

  @override
  State<GlassCard> createState() => _GlassCardState();
}

class _GlassCardState extends State<GlassCard> {
  bool _pressed = false;

  bool get _interactive => widget.onTap != null || widget.onLongPress != null;

  void _setPressed(bool v) {
    if (!_interactive || _pressed == v) return;
    setState(() => _pressed = v);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final br = widget.borderRadius;

    // The fill: either a flat override or the layered liquid sheen.
    final Decoration fillDecoration = widget.fillOpacity != null
        ? BoxDecoration(
            color: colors.glassFill.withValues(alpha: widget.fillOpacity),
            borderRadius: br,
          )
        : BoxDecoration(
            gradient: AppGradients.glassSheen(colors, intensity: widget.intensity),
            borderRadius: br,
          );

    // Core surface: sheen fill + border, with the specular highlight + inner
    // glow painted on top via a CustomPaint so they hug the rounded corners.
    Widget surface = DecoratedBox(
      decoration: fillDecoration,
      child: CustomPaint(
        painter: widget.highlight
            ? _GlassSpecularPainter(
                borderRadius: br,
                highlight: colors.glassHighlight,
                intensity: widget.intensity,
              )
            : null,
        foregroundPainter: widget.border
            ? _GlassBorderPainter(borderRadius: br, color: colors.glassBorder)
            : null,
        child: Padding(padding: widget.padding, child: widget.child),
      ),
    );

    // Live backdrop blur (skipped when blurSigma == 0 for perf).
    if (widget.blurSigma > 0) {
      surface = BackdropFilter(
        filter: ImageFilter.blur(
          sigmaX: widget.blurSigma,
          sigmaY: widget.blurSigma,
        ),
        child: surface,
      );
    }

    // Clip everything (blur + fill + paints) to the rounded rect.
    Widget content = ClipRRect(borderRadius: br, child: surface);

    // Ripple + tap/long-press, kept inside the clip.
    if (_interactive) {
      content = Stack(
        children: [
          content,
          Positioned.fill(
            child: Material(
              color: Colors.transparent,
              borderRadius: br,
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: widget.onTap,
                onLongPress: widget.onLongPress,
                onHighlightChanged: _setPressed,
                borderRadius: br,
                splashColor: colors.neonViolet.withValues(alpha: 0.12),
                highlightColor: colors.neonViolet.withValues(alpha: 0.06),
              ),
            ),
          ),
        ],
      );
    }

    // Ambient grounding shadow + optional neon glow live OUTSIDE the clip so
    // they bloom around the panel rather than being cut off.
    final shadows = <BoxShadow>[
      if (widget.shadow) ...AppShadows.glass(strength: widget.intensity),
      if (widget.glowColor != null)
        ...AppShadows.glow(widget.glowColor!, strength: widget.glowStrength),
    ];
    if (shadows.isNotEmpty) {
      content = DecoratedBox(
        decoration: BoxDecoration(borderRadius: br, boxShadow: shadows),
        child: content,
      );
    }

    // Tactile press: a gentle scale-down while held.
    if (_interactive) {
      content = AnimatedScale(
        scale: _pressed ? 0.985 : 1,
        duration: AppDurations.press,
        curve: AppCurves.glass,
        child: content,
      );
    }

    if (widget.margin != null) {
      content = Padding(padding: widget.margin!, child: content);
    }

    return content;
  }
}

/// Paints the soft specular highlight: a bright hairline hugging the top edge
/// that fades down a short way, giving the glass its "lit from above" sheen.
class _GlassSpecularPainter extends CustomPainter {
  const _GlassSpecularPainter({
    required this.borderRadius,
    required this.highlight,
    required this.intensity,
  });

  final BorderRadius borderRadius;
  final Color highlight;
  final double intensity;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final rrect = borderRadius.toRRect(rect);

    // A short vertical gradient from the highlight color (top) to transparent,
    // confined to the upper third — reads as a glassy top sheen.
    final sheenHeight = size.height * 0.5;
    final shader = LinearGradient(
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
      colors: [
        highlight.withValues(alpha: highlight.a * (0.9 * intensity).clamp(0.0, 1.0)),
        highlight.withValues(alpha: 0),
      ],
    ).createShader(Rect.fromLTWH(0, 0, size.width, sheenHeight));

    final paint = Paint()..shader = shader;
    canvas.save();
    canvas.clipRRect(rrect);
    canvas.drawRect(Rect.fromLTWH(0, 0, size.width, sheenHeight), paint);
    canvas.restore();

    // A crisp 1px bright line right at the very top edge for the "wet" rim.
    final topLine = Paint()
      ..color = highlight.withValues(alpha: highlight.a * (0.7 * intensity).clamp(0.0, 1.0))
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;
    final inset = rrect.deflate(0.5);
    final path = Path()
      ..moveTo(inset.left + inset.tlRadiusX, inset.top + 0.5)
      ..lineTo(inset.right - inset.trRadiusX, inset.top + 0.5);
    canvas.drawPath(path, topLine);
  }

  @override
  bool shouldRepaint(_GlassSpecularPainter old) =>
      old.highlight != highlight ||
      old.intensity != intensity ||
      old.borderRadius != borderRadius;
}

/// Paints the hairline glass border as a stroked rounded rect, inset by half a
/// pixel so it stays crisp at the clip edge.
class _GlassBorderPainter extends CustomPainter {
  const _GlassBorderPainter({required this.borderRadius, required this.color});

  final BorderRadius borderRadius;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final rrect = borderRadius.toRRect(Offset.zero & size).deflate(0.5);
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;
    canvas.drawRRect(rrect, paint);
  }

  @override
  bool shouldRepaint(_GlassBorderPainter old) =>
      old.color != color || old.borderRadius != borderRadius;
}
