import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';

/// Accent tone for the visualizer: peer (violet→magenta) vs local (cyan→violet).
enum VisualizerTone { peer, local }

/// An animated audio equalizer for the voice roulette — the Dart counterpart of
/// the web `VoiceVisualizer`. A large [NeonAvatar] sits at the centre with a
/// glow ring that pulses, surrounded by mirrored frequency bars painted in the
/// brand neon gradient.
///
/// flutter_webrtc on mobile does not expose a Web-Audio analyser, so rather than
/// fake precise FFT data we drive a lively, organic motion from a single
/// animation clock seeded per-band. The [active] flag (derived from track
/// liveness) modulates amplitude so a muted/absent stream visibly calms down.
class VoiceVisualizer extends StatefulWidget {
  const VoiceVisualizer({
    super.key,
    required this.name,
    this.avatarUrl,
    this.subtitle,
    this.tone = VisualizerTone.peer,
    this.active = true,
    this.compact = false,
  });

  final String name;
  final String? avatarUrl;
  final String? subtitle;
  final VisualizerTone tone;

  /// Whether audio is presumed flowing (drives bar amplitude + ring intensity).
  final bool active;

  /// Compact variant for the local self-tile.
  final bool compact;

  @override
  State<VoiceVisualizer> createState() => _VoiceVisualizerState();
}

class _VoiceVisualizerState extends State<VoiceVisualizer> with SingleTickerProviderStateMixin {
  late final AnimationController _clock;
  late final List<double> _phases;

  int get _bands => widget.compact ? 18 : 32;

  @override
  void initState() {
    super.initState();
    final rng = math.Random(widget.name.hashCode);
    _phases = List<double>.generate(_bands, (_) => rng.nextDouble() * math.pi * 2);
    _clock = AnimationController(vsync: this, duration: const Duration(seconds: 4))..repeat();
  }

  @override
  void dispose() {
    _clock.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final gradient = widget.tone == VisualizerTone.peer
        ? [colors.neonViolet, colors.neonMagenta]
        : [colors.neonCyan, colors.neonViolet];
    final glowColor = widget.tone == VisualizerTone.peer ? colors.neonMagenta : colors.neonCyan;
    final avatarSize = widget.compact ? 64.0 : 132.0;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Avatar with a pulsing glow ring.
        SizedBox(
          width: widget.compact ? 80 : 156,
          height: widget.compact ? 80 : 156,
          child: AnimatedBuilder(
            animation: _clock,
            builder: (context, child) {
              final pulse = widget.active
                  ? 0.5 + 0.5 * (0.5 + 0.5 * math.sin(_clock.value * math.pi * 2))
                  : 0.35;
              return Stack(
                alignment: Alignment.center,
                children: [
                  Container(
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      boxShadow: AppShadows.glow(glowColor, strength: 0.4 + pulse * 0.9),
                    ),
                  ),
                  child!,
                ],
              );
            },
            child: NeonAvatar(
              imageUrl: widget.avatarUrl,
              name: widget.name,
              size: avatarSize,
              glow: false,
            ),
          ),
        ),
        SizedBox(height: widget.compact ? AppSpacing.sm : AppSpacing.lg),

        // Equalizer.
        SizedBox(
          width: widget.compact ? 128 : 280,
          height: widget.compact ? 36 : 72,
          child: AnimatedBuilder(
            animation: _clock,
            builder: (context, _) => CustomPaint(
              painter: _EqualizerPainter(
                t: _clock.value,
                phases: _phases,
                gradient: gradient,
                amplitude: widget.active ? 1 : 0.18,
                compact: widget.compact,
              ),
            ),
          ),
        ),

        if (!widget.compact) ...[
          const SizedBox(height: AppSpacing.md),
          Text(
            widget.name,
            style: AppTypography.display(fontSize: 20, color: context.scheme.onSurface),
          ),
          if (widget.subtitle != null) ...[
            const SizedBox(height: 2),
            Text(
              widget.subtitle!,
              style: context.texts.bodyMedium?.copyWith(color: context.scheme.onSurfaceVariant),
            ),
          ],
        ],
      ],
    );
  }
}

class _EqualizerPainter extends CustomPainter {
  _EqualizerPainter({
    required this.t,
    required this.phases,
    required this.gradient,
    required this.amplitude,
    required this.compact,
  });

  final double t;
  final List<double> phases;
  final List<Color> gradient;
  final double amplitude;
  final bool compact;

  @override
  void paint(Canvas canvas, Size size) {
    final n = phases.length;
    final gap = compact ? 3.0 : 5.0;
    final barW = (size.width - gap * (n - 1)) / n;
    final midY = size.height / 2;
    final minH = compact ? 4.0 : 6.0;
    final radius = math.min(barW / 2, 4.0);

    final paint = Paint()
      ..shader = LinearGradient(colors: gradient).createShader(
        Rect.fromLTWH(0, 0, size.width, size.height),
      );

    for (var i = 0; i < n; i++) {
      // Two summed sines per band give a lively, non-repetitive motion.
      final a = math.sin(t * math.pi * 2 + phases[i]);
      final b = math.sin(t * math.pi * 4 + phases[i] * 1.7);
      final v = ((a * 0.6 + b * 0.4) * 0.5 + 0.5) * amplitude;
      final barH = math.max(minH, v * v * size.height * 0.92);
      final x = i * (barW + gap);
      final rect = RRect.fromRectAndRadius(
        Rect.fromLTWH(x, midY - barH / 2, barW, barH),
        Radius.circular(radius),
      );
      canvas.drawRRect(rect, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _EqualizerPainter old) =>
      old.t != t || old.amplitude != amplitude;
}
