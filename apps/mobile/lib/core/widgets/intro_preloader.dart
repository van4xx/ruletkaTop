import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../theme/theme.dart';
import 'brand_logo.dart';

/// SharedPreferences key for the one-time intro flag. Bump the suffix to replay
/// the intro for everyone after a major rebrand.
const String _kIntroSeenKey = 'ruletka:intro-seen-v1';

/// Returns whether the first-launch intro has already played on this install.
/// Defensive: any storage failure resolves to `true` (skip), so a prefs error
/// never traps the user behind a replaying intro.
Future<bool> hasSeenIntro() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_kIntroSeenKey) ?? false;
  } catch (_) {
    return true;
  }
}

/// Persist that the intro has played (best-effort).
Future<void> markIntroSeen() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kIntroSeenKey, true);
  } catch (_) {
    /* prefs unavailable — worst case the intro plays once more next launch */
  }
}

/// First-launch intro preloader — the native twin of the web `Preloader`.
///
/// On a user's very FIRST launch, a full-screen neon overlay plays a short
/// "roulette spin-up" of the logo over the signature aurora void, then fades to
/// reveal the app. Shown ONCE per install (persisted via [markIntroSeen]), so
/// it never interrupts returning users.
///
/// Honors the platform "reduce motion" accessibility setting: skips the
/// spin/scale and dismisses quickly.
///
/// Self-contained: drive it via [onFinished], which fires after the exit fade
/// so the host can drop the overlay.
class IntroPreloader extends StatefulWidget {
  const IntroPreloader({super.key, required this.onFinished});

  /// Called once the intro has fully played + faded out.
  final VoidCallback onFinished;

  @override
  State<IntroPreloader> createState() => _IntroPreloaderState();
}

class _IntroPreloaderState extends State<IntroPreloader>
    with TickerProviderStateMixin {
  /// Drives the logo spin-up + wordmark + progress sweep (the "play" phase).
  late final AnimationController _intro;

  /// Drives the final fade-to-app.
  late final AnimationController _fade;

  bool _reduceMotion = false;
  bool _started = false;

  @override
  void initState() {
    super.initState();
    _intro = AnimationController(vsync: this, duration: const Duration(milliseconds: 1700));
    _fade = AnimationController(vsync: this, duration: const Duration(milliseconds: 600), value: 1);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    _reduceMotion = MediaQuery.of(context).disableAnimations;
    _play();
  }

  Future<void> _play() async {
    // Mark seen immediately on mount, so a fast kill+relaunch won't replay it.
    await markIntroSeen();

    if (_reduceMotion) {
      _intro.value = 1;
      await Future<void>.delayed(const Duration(milliseconds: 900));
    } else {
      await _intro.forward();
      // Brief hold on the settled wheel + revealed wordmark.
      await Future<void>.delayed(const Duration(milliseconds: 500));
    }
    if (!mounted) return;
    await _fade.reverse(); // 1 → 0 opacity
    if (mounted) widget.onFinished();
  }

  @override
  void dispose() {
    _intro.dispose();
    _fade.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final reduce = _reduceMotion;

    return FadeTransition(
      opacity: _fade,
      child: Material(
        color: const Color(0xFF07070B),
        child: Stack(
          children: [
            // Aurora ambience — soft neon blobs over the void.
            const Positioned.fill(child: _AuroraVoid()),

            Center(
              child: AnimatedBuilder(
                animation: _intro,
                builder: (context, _) {
                  final t = _intro.value;
                  // Logo spin-up: 1.5 turns, decelerating like a settling wheel.
                  final eased = Curves.easeOutCubic.transform(t);
                  final rotation = reduce ? 0.0 : eased * 1.5 * 2 * math.pi;
                  final scale = reduce ? 1.0 : (0.55 + 0.45 * eased);
                  final logoOpacity = reduce ? t : Curves.easeOut.transform((t / 0.5).clamp(0.0, 1.0));

                  // Wordmark reveal (slides up + fades after the spin starts).
                  final wordT = ((t - 0.4) / 0.6).clamp(0.0, 1.0);
                  final wordEase = Curves.easeOutCubic.transform(wordT);

                  return Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Opacity(
                        opacity: logoOpacity,
                        child: Transform.rotate(
                          angle: rotation,
                          child: Transform.scale(
                            scale: scale,
                            child: const BrandLogo(size: 108, glow: true),
                          ),
                        ),
                      ),
                      const SizedBox(height: AppSpacing.xxl),
                      // Wordmark: "ruletka" + gradient ".top".
                      Opacity(
                        opacity: wordEase,
                        child: Transform.translate(
                          offset: Offset(0, (1 - wordEase) * 16),
                          child: _Wordmark(colors: colors),
                        ),
                      ),
                      const SizedBox(height: AppSpacing.xl),
                      // Neon progress sweep (skipped under reduce-motion).
                      if (!reduce)
                        _ProgressSweep(progress: t, colors: colors),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The "ruletka.top" wordmark — Unbounded, with a brand-gradient ".top".
class _Wordmark extends StatelessWidget {
  const _Wordmark({required this.colors});

  final AppColors colors;

  @override
  Widget build(BuildContext context) {
    final style = AppTypography.wordmark(fontSize: 32, color: Colors.white);
    return RichText(
      text: TextSpan(
        style: style,
        children: [
          const TextSpan(text: 'ruletka'),
          TextSpan(
            text: '.top',
            style: style.copyWith(
              foreground: Paint()
                ..shader = AppGradients.brand(
                  colors,
                  begin: Alignment.centerLeft,
                  end: Alignment.centerRight,
                ).createShader(const Rect.fromLTWH(0, 0, 120, 40)),
            ),
          ),
        ],
      ),
    );
  }
}

/// A 176px neon track that fills left→right as the intro plays.
class _ProgressSweep extends StatelessWidget {
  const _ProgressSweep({required this.progress, required this.colors});

  final double progress;
  final AppColors colors;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 176,
      height: 3,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(999),
        child: Stack(
          children: [
            Positioned.fill(
              child: ColoredBox(color: Colors.white.withValues(alpha: 0.10)),
            ),
            FractionallySizedBox(
              alignment: Alignment.centerLeft,
              widthFactor: progress.clamp(0.0, 1.0),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: AppGradients.brand(
                    colors,
                    begin: Alignment.centerLeft,
                    end: Alignment.centerRight,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The signature aurora void: three soft neon blobs over near-black, matching
/// the web preloader's `bg-aurora-radial` ambience.
class _AuroraVoid extends StatelessWidget {
  const _AuroraVoid();

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return IgnorePointer(
      child: Stack(
        children: [
          // Dominant violet bloom, centred.
          Center(
            child: Container(
              width: 460,
              height: 460,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    colors.neonViolet.withValues(alpha: 0.30),
                    const Color(0x0007070B),
                  ],
                  stops: const [0.0, 0.62],
                ),
              ),
            ),
          ),
          // Cyan accent, upper-right.
          Positioned(
            right: -100,
            top: -60,
            child: _Blob(color: colors.neonCyan, size: 300, strength: 0.18),
          ),
          // Magenta counterweight, lower-left.
          Positioned(
            left: -120,
            bottom: -80,
            child: _Blob(color: colors.neonMagenta, size: 320, strength: 0.16),
          ),
        ],
      ),
    );
  }
}

class _Blob extends StatelessWidget {
  const _Blob({required this.color, required this.size, required this.strength});

  final Color color;
  final double size;
  final double strength;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(
          colors: [color.withValues(alpha: strength), color.withValues(alpha: 0)],
        ),
      ),
    );
  }
}
