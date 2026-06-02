import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/router/routes.dart';
import '../../../../core/theme/theme.dart';

/// The dashboard's primary call-to-action: two large, exciting tiles that start
/// the video or voice roulette. Each carries a living gradient wash, a soft
/// neon icon halo, an animated "В эфире" live pulse, and an arrow that nudges on
/// press. Mirrors the web `QuickLaunch`.
class QuickLaunch extends StatelessWidget {
  const QuickLaunch({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: _LaunchTile(
            icon: Icons.videocam_rounded,
            title: 'Видеочат',
            subtitle: 'Случайные видеозвонки со всем миром',
            accent: colors.neonViolet,
            secondAccent: colors.neonMagenta,
            onTap: () => context.go(AppRoutes.video),
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: _LaunchTile(
            icon: Icons.mic_rounded,
            title: 'Голосовой чат',
            subtitle: 'Только голос — чисто и анонимно',
            accent: colors.neonCyan,
            secondAccent: colors.neonViolet,
            onTap: () => context.go(AppRoutes.voice),
          ),
        ),
      ],
    );
  }
}

class _LaunchTile extends StatefulWidget {
  const _LaunchTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.accent,
    required this.secondAccent,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Color accent;
  final Color secondAccent;
  final VoidCallback onTap;

  @override
  State<_LaunchTile> createState() => _LaunchTileState();
}

class _LaunchTileState extends State<_LaunchTile> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;

    return GestureDetector(
      onTapDown: (_) => setState(() => _pressed = true),
      onTapUp: (_) => setState(() => _pressed = false),
      onTapCancel: () => setState(() => _pressed = false),
      onTap: widget.onTap,
      child: AnimatedScale(
        scale: _pressed ? 0.97 : 1,
        duration: AppDurations.fast,
        curve: Curves.easeOut,
        child: Container(
          constraints: const BoxConstraints(minHeight: 176),
          decoration: BoxDecoration(
            borderRadius: AppRadii.brXxl,
            border: Border.all(color: colors.glassBorder),
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                widget.accent.withValues(alpha: 0.35),
                widget.secondAccent.withValues(alpha: 0.18),
                context.scheme.surfaceContainerHighest.withValues(alpha: 0.0),
              ],
            ),
            boxShadow: AppShadows.glow(widget.accent, strength: 0.35),
          ),
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Icon with neon halo.
                    Container(
                      width: 52,
                      height: 52,
                      decoration: BoxDecoration(
                        borderRadius: AppRadii.brLg,
                        color: context.scheme.surface.withValues(alpha: 0.7),
                        border: Border.all(color: colors.glassBorder),
                        boxShadow: AppShadows.glow(widget.accent, strength: 0.5),
                      ),
                      child: Icon(widget.icon, size: 28, color: widget.accent),
                    ),
                    _LivePulse(color: widget.accent),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      widget.title,
                      style: context.texts.headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      widget.subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: context.texts.bodySmall?.copyWith(
                          color: context.scheme.onSurfaceVariant),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Row(
                      children: [
                        Text(
                          'Начать',
                          style: context.texts.labelLarge
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(width: 4),
                        AnimatedSlide(
                          offset: Offset(_pressed ? 0.4 : 0, 0),
                          duration: AppDurations.fast,
                          child: const Icon(Icons.arrow_forward_rounded, size: 18),
                        ),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A small pulsing "В эфире" (live) chip.
class _LivePulse extends StatefulWidget {
  const _LivePulse({required this.color});

  final Color color;

  @override
  State<_LivePulse> createState() => _LivePulseState();
}

class _LivePulseState extends State<_LivePulse>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 4),
      decoration: BoxDecoration(
        borderRadius: AppRadii.brPill,
        color: context.scheme.surface.withValues(alpha: 0.5),
        border: Border.all(color: context.colors.glassBorder),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 8,
            height: 8,
            child: reduceMotion
                ? _dot()
                : AnimatedBuilder(
                    animation: _controller,
                    builder: (context, child) {
                      return Stack(
                        alignment: Alignment.center,
                        children: [
                          Transform.scale(
                            scale: 1 + _controller.value * 1.6,
                            child: Opacity(
                              opacity: (1 - _controller.value) * 0.7,
                              child: _dot(),
                            ),
                          ),
                          _dot(),
                        ],
                      );
                    },
                  ),
          ),
          const SizedBox(width: 6),
          Text(
            'В эфире',
            style: context.texts.labelSmall?.copyWith(
                color: context.scheme.onSurfaceVariant,
                fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }

  Widget _dot() => DecoratedBox(
        decoration: BoxDecoration(shape: BoxShape.circle, color: widget.color),
        child: const SizedBox(width: 8, height: 8),
      );
}
