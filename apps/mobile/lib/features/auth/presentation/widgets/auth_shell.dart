import 'package:flutter/material.dart';

import '../../../../core/theme/theme.dart';

/// The branded hero/split shell shared by the login and register screens.
///
/// On a tall, narrow phone it's a single scrollable column: the [_AuthHero]
/// (logo + wordmark + tagline) stacked over the form card. On a wide layout
/// (tablet / landscape) it becomes a true split — the hero pinned to the left
/// over a neon gradient, the form to the right — mirroring the web's auth
/// split layout while staying mobile-first and dark-first.
class AuthShell extends StatelessWidget {
  const AuthShell({
    super.key,
    required this.child,
    this.tagline = 'Знакомства и общение по видео',
  });

  /// The form card (already wrapped in a [GlassCard] by the caller).
  final Widget child;
  final String tagline;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;

    return Scaffold(
      body: DecoratedBox(
        decoration: BoxDecoration(
          gradient: RadialGradient(
            center: const Alignment(0, -0.85),
            radius: 1.4,
            colors: [
              colors.neonViolet.withValues(alpha: context.isDark ? 0.18 : 0.10),
              context.scheme.surface,
            ],
            stops: const [0, 0.7],
          ),
        ),
        child: SafeArea(
          child: LayoutBuilder(
            builder: (context, constraints) {
              final isWide = constraints.maxWidth >= 860;
              if (isWide) {
                return Row(
                  children: [
                    Expanded(
                      child: _AuthHero(tagline: tagline, large: true),
                    ),
                    Expanded(
                      child: _FormViewport(child: child),
                    ),
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
/// never overflows it.
class _FormViewport extends StatelessWidget {
  const _FormViewport({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: child,
        ),
      ),
    );
  }
}

/// The brand lockup: a glowing gradient bolt mark, the gradient wordmark and a
/// tagline. Scales up in the wide split via [large].
class _AuthHero extends StatelessWidget {
  const _AuthHero({required this.tagline, this.large = false});

  final String tagline;
  final bool large;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final markSize = large ? 96.0 : 76.0;

    return Padding(
      padding: EdgeInsets.all(large ? AppSpacing.xxxl : 0),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment:
            large ? CrossAxisAlignment.start : CrossAxisAlignment.center,
        children: [
          Container(
            width: markSize,
            height: markSize,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(colors: colors.brandGradient),
              boxShadow: AppShadows.glow(colors.neonViolet, strength: 0.7),
            ),
            child: Icon(Icons.bolt_rounded, size: markSize * 0.52, color: Colors.white),
          ),
          const SizedBox(height: AppSpacing.lg),
          ShaderMask(
            shaderCallback: (b) =>
                LinearGradient(colors: colors.brandGradient).createShader(b),
            child: Text(
              'ruletka.top',
              style: AppTypography.display(
                fontSize: large ? 44 : 34,
                color: Colors.white,
                letterSpacing: -1,
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            tagline,
            textAlign: large ? TextAlign.start : TextAlign.center,
            style: context.texts.bodyLarge
                ?.copyWith(color: context.scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

/// A compact inline error banner for auth forms (surfaces the auth controller's
/// `errorMessage`). Glassy destructive container with an icon + message.
class AuthErrorBanner extends StatelessWidget {
  const AuthErrorBanner({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.errorContainer.withValues(alpha: 0.5),
        borderRadius: AppRadii.brMd,
        border: Border.all(color: scheme.error.withValues(alpha: 0.5)),
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline_rounded, size: 18, color: scheme.error),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              message,
              style: context.texts.bodySmall
                  ?.copyWith(color: scheme.onErrorContainer),
            ),
          ),
        ],
      ),
    );
  }
}
