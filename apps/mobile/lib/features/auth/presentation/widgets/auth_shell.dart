import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';

/// The branded liquid-glass shell shared by the login and register screens — the
/// app's front door. It mirrors the website's split auth layout (`AuthShell` in
/// `apps/web`): a full neon-aurora canvas, the rotating "roulette" emblem, the
/// `ruletka.top` wordmark (foreground + gradient `.top`), a per-screen pitch and
/// the three brand perks (instant / secure / live).
///
/// On a tall, narrow phone it's a single keyboard-aware scrollable column: the
/// [_AuthHero] stacked over the form card. On a wide layout (tablet / landscape)
/// it becomes a true split — the hero pinned left, the form centered right —
/// exactly like the web.
class AuthShell extends StatelessWidget {
  const AuthShell({
    super.key,
    required this.child,
    this.tagline = 'Встреться с миром в одном клике',
  });

  /// The form card (already wrapped in a [GlassCard] by the caller).
  final Widget child;

  /// The per-screen pitch headline shown beneath the wordmark (mirrors the
  /// web's `auth.shell.pitch.*`).
  final String tagline;

  @override
  Widget build(BuildContext context) {
    // Full signature neon-aurora void behind everything — same backdrop the rest
    // of the app floats on, so the entry point already feels like "home".
    return Scaffold(
      backgroundColor: context.scheme.surface,
      body: AuroraBackground(
        child: SafeArea(
          child: LayoutBuilder(
            builder: (context, constraints) {
              final isWide = constraints.maxWidth >= 860;
              if (isWide) {
                return Row(
                  children: [
                    Expanded(child: _AuthHero(tagline: tagline, large: true)),
                    Expanded(child: _FormViewport(child: child)),
                  ],
                );
              }
              return _FormViewport(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _AuthHero(tagline: tagline),
                    const SizedBox(height: AppSpacing.xxl),
                    child,
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

/// Centers + constrains the form column and makes it scrollable so the keyboard
/// never overflows it. A gentle fade-and-rise entrance gives the front door a
/// premium first beat.
class _FormViewport extends StatelessWidget {
  const _FormViewport({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.xl,
          AppSpacing.xxl,
          AppSpacing.xl,
          AppSpacing.xxl,
        ),
        // Keep the form clear of the on-screen keyboard.
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: const _RiseIn().wrap(child),
        ),
      ),
    );
  }
}

/// A tiny entrance animator: fades + lifts its child once on mount. Stateless
/// callers use [wrap]; it builds a one-shot [TweenAnimationBuilder] so there's
/// no controller to manage.
class _RiseIn {
  const _RiseIn();

  Widget wrap(Widget child) => TweenAnimationBuilder<double>(
        tween: Tween(begin: 0, end: 1),
        duration: AppDurations.slow,
        curve: AppCurves.emphasized,
        builder: (context, t, c) => Opacity(
          opacity: t.clamp(0.0, 1.0),
          child: Transform.translate(offset: Offset(0, (1 - t) * 18), child: c),
        ),
        child: child,
      );
}

/// The brand lockup: the rotating roulette emblem, the `ruletka.top` wordmark
/// (foreground + neon-gradient `.top`), the per-screen pitch and the three perk
/// rows. Scales up + left-aligns in the wide split via [large].
class _AuthHero extends StatelessWidget {
  const _AuthHero({required this.tagline, this.large = false});

  final String tagline;
  final bool large;

  static const _perks = <(IconData, String)>[
    (Icons.bolt_rounded, 'Мгновенный коннект'),
    (Icons.shield_outlined, 'Безопасно и анонимно'),
    (Icons.auto_awesome_rounded, 'Живое общение'),
  ];

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final cross =
        large ? CrossAxisAlignment.start : CrossAxisAlignment.center;

    return Padding(
      padding: EdgeInsets.all(large ? AppSpacing.xxxl : 0),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: cross,
        children: [
          RouletteEmblem(size: large ? 72 : 60),
          SizedBox(height: large ? AppSpacing.xl : AppSpacing.lg),

          // ruletka.top — "ruletka" in the foreground, ".top" in the neon
          // gradient, exactly like the website wordmark.
          _Wordmark(fontSize: large ? 44 : 34),
          const SizedBox(height: AppSpacing.md),

          // The per-screen pitch headline (Unbounded display).
          ConstrainedBox(
            constraints: BoxConstraints(maxWidth: large ? 360 : 320),
            child: Text(
              tagline,
              textAlign: large ? TextAlign.start : TextAlign.center,
              style: AppTypography.display(
                fontSize: large ? 26 : 21,
                fontWeight: FontWeight.w700,
                color: context.scheme.onSurface,
                height: 1.15,
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.xl),

          // The three brand perks — glass icon chip + label, mirroring the web.
          Wrap(
            alignment: large ? WrapAlignment.start : WrapAlignment.center,
            runAlignment: WrapAlignment.center,
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              for (final (icon, label) in _perks)
                _PerkChip(icon: icon, label: label, accent: colors.neonViolet),
            ],
          ),
        ],
      ),
    );
  }
}

/// The `ruletka.top` wordmark: `ruletka` in the foreground color and `.top`
/// painted with the violet→magenta→cyan neon gradient (matching the web's
/// `text-gradient-neon`).
class _Wordmark extends StatelessWidget {
  const _Wordmark({required this.fontSize});

  final double fontSize;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final base = AppTypography.wordmark(fontSize: fontSize);
    // The web's neon text gradient: violet → magenta (45%) → cyan, ~100deg.
    final gradient = LinearGradient(
      colors: [colors.neonViolet, colors.neonMagenta, colors.neonCyan],
      stops: const [0.0, 0.45, 1.0],
      begin: Alignment.centerLeft,
      end: Alignment.centerRight,
    );

    return RichText(
      text: TextSpan(
        style: base.copyWith(color: context.scheme.onSurface),
        children: [
          const TextSpan(text: 'ruletka'),
          WidgetSpan(
            alignment: PlaceholderAlignment.baseline,
            baseline: TextBaseline.alphabetic,
            child: ShaderMask(
              shaderCallback: (b) => gradient.createShader(b),
              child: Text('.top', style: base.copyWith(color: Colors.white)),
            ),
          ),
        ],
      ),
    );
  }
}

/// A single brand-perk pill: a frosted glass chip with a neon icon + label.
class _PerkChip extends StatelessWidget {
  const _PerkChip({
    required this.icon,
    required this.label,
    required this.accent,
  });

  final IconData icon;
  final String label;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return GlassCard(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
      borderRadius: AppRadii.brPill,
      intensity: 0.7,
      blurSigma: AppBlur.subtle,
      shadow: false,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: accent),
          const SizedBox(width: AppSpacing.xs + 2),
          Text(
            label,
            style: context.texts.labelMedium?.copyWith(
              color: context.scheme.onSurface.withValues(alpha: 0.9),
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

/// The rotating "roulette" emblem — the website's brand mark, ported to native:
/// a slowly spinning conic neon ring (violet → magenta → cyan), a dark inner
/// disc that carves the ring into a halo, and a glowing cyan hub dot at the
/// center. Honors the platform reduce-motion flag (renders static).
class RouletteEmblem extends StatefulWidget {
  const RouletteEmblem({super.key, this.size = 60});

  final double size;

  @override
  State<RouletteEmblem> createState() => _RouletteEmblemState();
}

class _RouletteEmblemState extends State<RouletteEmblem>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 8),
  );

  @override
  void initState() {
    super.initState();
    final reduceMotion = WidgetsBinding
        .instance.platformDispatcher.accessibilityFeatures.disableAnimations;
    if (!reduceMotion) _controller.repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;
    final size = widget.size;
    // The ring is a thin neon band; the dark core carves it into a halo.
    final coreInset = size * 0.16;
    final hub = (size * 0.16).clamp(8.0, 14.0);

    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Soft outer bloom so the emblem reads as a lit object.
          DecoratedBox(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              boxShadow: AppShadows.glow(colors.neonViolet, strength: 0.65),
            ),
            child: SizedBox(width: size, height: size),
          ),
          // The spinning conic neon ring.
          RotationTransition(
            turns: _controller,
            child: Container(
              width: size,
              height: size,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: SweepGradient(
                  transform: const GradientRotation(-math.pi / 2),
                  colors: [
                    colors.neonViolet,
                    colors.neonMagenta,
                    colors.neonCyan,
                    colors.neonViolet,
                  ],
                ),
              ),
            ),
          ),
          // The dark core disc that turns the gradient into a ring/halo.
          Container(
            width: size - coreInset * 2,
            height: size - coreInset * 2,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: scheme.surface,
            ),
          ),
          // The glowing cyan hub dot at the very center.
          Container(
            width: hub,
            height: hub,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: colors.neonCyan,
              boxShadow: [
                BoxShadow(
                  color: colors.neonCyan.withValues(alpha: 0.8),
                  blurRadius: 12,
                  spreadRadius: -1,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A compact inline error banner for auth forms (surfaces the auth controller's
/// `errorMessage`). A glassy destructive container with an icon + message and a
/// soft entrance, matching the web's animated alert.
class AuthErrorBanner extends StatelessWidget {
  const AuthErrorBanner({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: AppDurations.normal,
      curve: AppCurves.glass,
      builder: (context, t, child) => Opacity(
        opacity: t.clamp(0.0, 1.0),
        child: Transform.translate(offset: Offset(0, (1 - t) * -6), child: child),
      ),
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.md - 1,
        ),
        decoration: BoxDecoration(
          color: scheme.error.withValues(alpha: 0.12),
          borderRadius: AppRadii.brMd,
          border: Border.all(color: scheme.error.withValues(alpha: 0.4)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.error_outline_rounded, size: 18, color: scheme.error),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                message,
                style: context.texts.bodySmall?.copyWith(
                  color: scheme.error,
                  fontWeight: FontWeight.w600,
                  height: 1.35,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
