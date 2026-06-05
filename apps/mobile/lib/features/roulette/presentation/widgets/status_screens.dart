import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/router/routes.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../../data/media_permissions.dart';
import '../../domain/roulette_state.dart';

/// Shared centered shell for every non-connected roulette state. Optionally
/// crowns the content with the gradient **ruletka** wordmark so every status
/// screen feels unmistakably on-brand, exactly like the website.
class _Shell extends StatelessWidget {
  const _Shell({required this.children, this.wordmark = false});

  final List<Widget> children;
  final bool wordmark;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 360),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (wordmark) ...[
                const _Wordmark(fontSize: 26),
                const SizedBox(height: AppSpacing.xxl),
              ],
              ...children,
            ],
          ),
        ),
      ),
    );
  }
}

/// The gradient "ruletka" wordmark (Unbounded, violet→cyan→magenta), used to
/// crown the hero status screens.
class _Wordmark extends StatelessWidget {
  const _Wordmark({this.fontSize = 24});

  final double fontSize;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return ShaderMask(
      shaderCallback: (bounds) => AppGradients.brand(
        colors,
        begin: Alignment.centerLeft,
        end: Alignment.centerRight,
      ).createShader(bounds),
      child: Text(
        'ruletka',
        style: AppTypography.wordmark(fontSize: fontSize, color: Colors.white),
      ),
    );
  }
}

/// Idle pre-flight hero (before the first Start). A glassy rounded tile lit by a
/// slowly-breathing neon-violet bloom — the native twin of the web idle screen.
class IdleScreen extends StatefulWidget {
  const IdleScreen({super.key, required this.isVideo});

  final bool isVideo;

  @override
  State<IdleScreen> createState() => _IdleScreenState();
}

class _IdleScreenState extends State<IdleScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2600),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return _Shell(
      wordmark: true,
      children: [
        SizedBox(
          width: 112,
          height: 112,
          child: AnimatedBuilder(
            animation: _c,
            builder: (context, child) {
              final pulse = 0.5 + 0.5 * _c.value;
              return Stack(
                alignment: Alignment.center,
                children: [
                  // Breathing radial bloom behind the tile.
                  Container(
                    width: 112,
                    height: 112,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: RadialGradient(
                        colors: [
                          colors.neonViolet.withValues(
                            alpha: 0.22 + pulse * 0.18,
                          ),
                          colors.neonViolet.withValues(alpha: 0),
                        ],
                      ),
                    ),
                  ),
                  child!,
                ],
              );
            },
            child: GlassCard(
              padding: EdgeInsets.zero,
              borderRadius: AppRadii.brXxl,
              blurSigma: AppBlur.glass,
              glowColor: colors.neonViolet,
              glowStrength: 0.5,
              child: SizedBox(
                width: 72,
                height: 72,
                child: Icon(
                  Icons.auto_awesome_rounded,
                  size: 34,
                  color: colors.neonCyan,
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        Text(
          widget.isVideo ? 'Видеорулетка' : 'Голосовая рулетка',
          textAlign: TextAlign.center,
          style: AppTypography.display(
            fontSize: 26,
            color: context.scheme.onSurface,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          widget.isVideo
              ? 'Нажмите «Начать» — мы попросим доступ к камере и микрофону и найдём собеседника.'
              : 'Нажмите «Начать» — мы попросим доступ к микрофону и найдём собеседника.',
          textAlign: TextAlign.center,
          style: context.texts.bodyMedium?.copyWith(
            color: context.scheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

/// Searching / waiting radar with concentric neon pulses + an orbiting comet
/// ring, crowned by the wordmark — the signature "looking for someone" moment.
class SearchingScreen extends StatefulWidget {
  const SearchingScreen({super.key, this.positionHint, this.longWait = false});

  final int? positionHint;
  final bool longWait;

  @override
  State<SearchingScreen> createState() => _SearchingScreenState();
}

class _SearchingScreenState extends State<SearchingScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2600),
  )..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final hint = widget.positionHint;
    final subtitle = widget.longWait
        ? 'Пока тихо в эфире. Попробуйте смягчить фильтры — найдём быстрее.'
        : (hint != null && hint > 0)
        ? 'Вы в очереди: позиция $hint'
        : 'Это займёт пару секунд.';

    return _Shell(
      wordmark: true,
      children: [
        SizedBox(
          width: 132,
          height: 132,
          child: AnimatedBuilder(
            animation: _c,
            builder: (context, child) {
              return Stack(
                alignment: Alignment.center,
                children: [
                  // Two expanding pulse rings, phase-shifted.
                  _pulse(colors.neonViolet, _c.value),
                  _pulse(colors.neonCyan, (_c.value + 0.4) % 1.0),
                  // A neon comet sweeping the orbit.
                  CustomPaint(
                    size: const Size(124, 124),
                    painter: _CometRingPainter(
                      t: _c.value,
                      colors: [
                        colors.neonViolet,
                        colors.neonCyan,
                        colors.neonMagenta,
                      ],
                    ),
                  ),
                  child!,
                ],
              );
            },
            child: GlassCard(
              padding: EdgeInsets.zero,
              borderRadius: AppRadii.brPill,
              blurSigma: AppBlur.glass,
              glowColor: colors.neonCyan,
              glowStrength: 0.45,
              child: SizedBox(
                width: 68,
                height: 68,
                child: AnimatedBuilder(
                  animation: _c,
                  builder: (context, _) => Transform.rotate(
                    angle: _c.value * 2 * math.pi,
                    child: Icon(
                      Icons.radar_rounded,
                      size: 30,
                      color: colors.neonCyan,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        Text(
          'Ищем собеседника…',
          textAlign: TextAlign.center,
          style: AppTypography.display(
            fontSize: 20,
            color: context.scheme.onSurface,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          subtitle,
          textAlign: TextAlign.center,
          style: context.texts.bodyMedium?.copyWith(
            color: context.scheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }

  Widget _pulse(Color color, double t) {
    final size = 60 + t * 72;
    return Opacity(
      opacity: (1 - t) * 0.5,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: color.withValues(alpha: 0.5), width: 1.4),
        ),
      ),
    );
  }
}

/// Paints a soft neon comet (a fading arc) sweeping clockwise around a ring,
/// for the "scanning the ether" feel beneath the searching radar.
class _CometRingPainter extends CustomPainter {
  _CometRingPainter({required this.t, required this.colors});

  final double t;
  final List<Color> colors;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2 - 3;
    final rect = Rect.fromCircle(center: center, radius: radius);
    final start = t * 2 * math.pi;

    // A SweepGradient tail (transparent → bright) rotated to the comet head.
    final shader = SweepGradient(
      startAngle: 0,
      endAngle: 2 * math.pi,
      transform: GradientRotation(start),
      colors: [
        colors[0].withValues(alpha: 0),
        colors[1].withValues(alpha: 0.0),
        colors[2].withValues(alpha: 0.9),
      ],
      stops: const [0.0, 0.72, 1.0],
    ).createShader(rect);

    final paint = Paint()
      ..shader = shader
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 3;
    // Draw most of the circle; the gradient fades the tail so it reads as a comet.
    canvas.drawArc(rect, start, 1.9 * math.pi, false, paint);
  }

  @override
  bool shouldRepaint(_CometRingPainter old) => old.t != t;
}

/// Brief interstitial when a peer leaves before auto-requeue — a neon orbiting
/// loader over a calm "finding the next one" message.
class EndedScreen extends StatelessWidget {
  const EndedScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return _Shell(
      children: [
        const NeonPulseLoader(size: 52, tone: VisualizerLoaderTone.magenta),
        const SizedBox(height: AppSpacing.lg),
        Text(
          'Собеседник отключился',
          textAlign: TextAlign.center,
          style: AppTypography.display(
            fontSize: 18,
            color: context.scheme.onSurface,
          ),
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(
          'Ищем следующего…',
          textAlign: TextAlign.center,
          style: context.texts.bodyMedium?.copyWith(
            color: context.scheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

/// Tone for [NeonPulseLoader].
enum VisualizerLoaderTone { violet, cyan, magenta }

/// A signature pulsing neon loader: a soft glowing core with two orbiting dots
/// tracing a ring. Reusable across the "connecting / matching / ended" beats so
/// every transient state feels alive and brand-consistent (no flat spinners).
class NeonPulseLoader extends StatefulWidget {
  const NeonPulseLoader({
    super.key,
    this.size = 56,
    this.tone = VisualizerLoaderTone.violet,
  });

  final double size;
  final VisualizerLoaderTone tone;

  @override
  State<NeonPulseLoader> createState() => _NeonPulseLoaderState();
}

class _NeonPulseLoaderState extends State<NeonPulseLoader>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final (a, b) = switch (widget.tone) {
      VisualizerLoaderTone.violet => (colors.neonViolet, colors.neonCyan),
      VisualizerLoaderTone.cyan => (colors.neonCyan, colors.neonViolet),
      VisualizerLoaderTone.magenta => (colors.neonMagenta, colors.neonViolet),
    };
    return SizedBox(
      width: widget.size,
      height: widget.size,
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) => CustomPaint(
          painter: _NeonPulsePainter(t: _c.value, a: a, b: b),
        ),
      ),
    );
  }
}

class _NeonPulsePainter extends CustomPainter {
  _NeonPulsePainter({required this.t, required this.a, required this.b});

  final double t;
  final Color a;
  final Color b;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final r = size.width / 2;
    final ringR = r * 0.74;

    // Breathing core.
    final pulse = 0.5 + 0.5 * math.sin(t * math.pi * 2);
    final coreR = r * (0.26 + pulse * 0.06);
    final corePaint = Paint()
      ..shader = _radialShader(center, coreR * 2.2, [
        a.withValues(alpha: 0.9),
        a.withValues(alpha: 0),
      ]);
    canvas.drawCircle(center, coreR * 2.2, corePaint);
    canvas.drawCircle(center, coreR, Paint()..color = a);

    // Faint guide ring.
    canvas.drawCircle(
      center,
      ringR,
      Paint()
        ..color = a.withValues(alpha: 0.18)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.4,
    );

    // Two orbiting dots, opposite phase.
    for (var i = 0; i < 2; i++) {
      final ang = t * 2 * math.pi + i * math.pi;
      final p = center + Offset(math.cos(ang) * ringR, math.sin(ang) * ringR);
      final color = i == 0 ? a : b;
      canvas.drawCircle(
        p,
        r * 0.16,
        Paint()
          ..color = color
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3),
      );
      canvas.drawCircle(p, r * 0.1, Paint()..color = color);
    }
  }

  @override
  bool shouldRepaint(_NeonPulsePainter old) => old.t != t;
}

/// Tiny helper: a radial shader (kept local so the painter stays self-contained).
Shader _radialShader(Offset center, double radius, List<Color> colors) {
  return RadialGradient(
    colors: colors,
  ).createShader(Rect.fromCircle(center: center, radius: radius));
}

/// Recoverable error (permission / device / network / auth).
class RouletteErrorScreen extends StatelessWidget {
  const RouletteErrorScreen({
    super.key,
    required this.error,
    required this.onRetry,
  });

  final RouletteError error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final (icon, title) = switch (error.kind) {
      'denied' || 'permanentlyDenied' => (
        Icons.mic_off_rounded,
        'Нет доступа к устройствам',
      ),
      'notfound' => (Icons.videocam_off_rounded, 'Устройство не найдено'),
      'inuse' => (Icons.warning_amber_rounded, 'Устройство занято'),
      'insecure' => (Icons.warning_amber_rounded, 'Устройство недоступно'),
      'socket' || 'timeout' => (Icons.wifi_off_rounded, 'Нет соединения'),
      'auth' => (Icons.login_rounded, 'Войдите, чтобы начать'),
      _ => (Icons.error_outline_rounded, 'Что-то пошло не так'),
    };
    final isAuth = error.kind == 'auth';
    final isPermanent = error.kind == 'permanentlyDenied';

    return _Shell(
      children: [
        GlassCard(
          padding: EdgeInsets.zero,
          borderRadius: AppRadii.brXl,
          blurSigma: AppBlur.glass,
          child: SizedBox(
            width: 64,
            height: 64,
            child: Icon(icon, size: 32, color: context.scheme.error),
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        Text(
          title,
          textAlign: TextAlign.center,
          style: AppTypography.display(
            fontSize: 20,
            color: context.scheme.onSurface,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          error.message,
          textAlign: TextAlign.center,
          style: context.texts.bodyMedium?.copyWith(
            color: context.scheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        if (isAuth)
          GradientButton(
            label: 'Войти',
            icon: Icons.login_rounded,
            fullWidth: false,
            onPressed: () => context.go(AppRoutes.login),
          )
        else if (isPermanent)
          GradientButton(
            label: 'Открыть настройки',
            icon: Icons.settings_rounded,
            fullWidth: false,
            onPressed: () => MediaPermissions.openSettings(),
          )
        else
          GradientButton(
            label: 'Попробовать снова',
            fullWidth: false,
            onPressed: onRetry,
          ),
      ],
    );
  }
}

/// Shown when there is definitively no session (unauthenticated).
class SignInScreen extends StatelessWidget {
  const SignInScreen({super.key, required this.isVideo});

  final bool isVideo;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return _Shell(
      wordmark: true,
      children: [
        GlassCard(
          padding: EdgeInsets.zero,
          borderRadius: AppRadii.brXl,
          blurSigma: AppBlur.glass,
          glowColor: colors.neonViolet,
          glowStrength: 0.4,
          child: SizedBox(
            width: 64,
            height: 64,
            child: Icon(
              Icons.login_rounded,
              size: 32,
              color: colors.neonViolet,
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        Text(
          'Войдите, чтобы начать',
          textAlign: TextAlign.center,
          style: AppTypography.display(
            fontSize: 20,
            color: context.scheme.onSurface,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          '${isVideo ? 'Видеорулетка' : 'Голосовая рулетка'} доступна авторизованным пользователям. Это займёт минуту.',
          textAlign: TextAlign.center,
          style: context.texts.bodyMedium?.copyWith(
            color: context.scheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            GradientButton(
              label: 'Войти',
              fullWidth: false,
              onPressed: () => context.go(AppRoutes.login),
            ),
            const SizedBox(width: AppSpacing.md),
            OutlinedButton(
              onPressed: () => context.push(AppRoutes.register),
              child: const Text('Регистрация'),
            ),
          ],
        ),
      ],
    );
  }
}
