import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/router/routes.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';

/// The dashboard's primary call-to-action grid: four large, tappable glass
/// tiles. The two hero tiles (Видеочат → /video, Голосовой → /voice) carry a
/// living neon wash, a glowing gradient icon chip and an animated "В эфире"
/// live pulse; the two utility tiles (Топ → /top, Поиск → /search) are calmer
/// glass with the same neon icon language. Mirrors the web `QuickLaunch`,
/// extended to the four shortcuts the brief calls for.
class QuickLaunch extends StatelessWidget {
  const QuickLaunch({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    const gap = AppSpacing.md;

    return Column(
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: _LaunchTile(
                icon: Icons.videocam_rounded,
                title: 'Видеочат',
                subtitle: 'Случайные видеозвонки со всем миром',
                accent: colors.neonViolet,
                secondAccent: colors.neonMagenta,
                live: true,
                onTap: () => context.go(AppRoutes.video),
              ),
            ),
            const SizedBox(width: gap),
            Expanded(
              child: _LaunchTile(
                icon: Icons.mic_rounded,
                title: 'Голосовой чат',
                subtitle: 'Только голос — чисто и анонимно',
                accent: colors.neonCyan,
                secondAccent: colors.neonViolet,
                live: true,
                onTap: () => context.go(AppRoutes.voice),
              ),
            ),
          ],
        ),
        const SizedBox(height: gap),
        Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: _LaunchTile(
                icon: Icons.emoji_events_rounded,
                title: 'Топ эфира',
                subtitle: 'Кто в центре внимания прямо сейчас',
                accent: colors.warning,
                secondAccent: colors.neonMagenta,
                compact: true,
                onTap: () => context.go(AppRoutes.top),
              ),
            ),
            const SizedBox(width: gap),
            Expanded(
              child: _LaunchTile(
                icon: Icons.search_rounded,
                title: 'Поиск людей',
                subtitle: 'Найдите новых друзей по интересам',
                accent: colors.neonMagenta,
                secondAccent: colors.neonViolet,
                compact: true,
                onTap: () => context.go(AppRoutes.search),
              ),
            ),
          ],
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
    this.live = false,
    this.compact = false,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Color accent;
  final Color secondAccent;
  final VoidCallback onTap;

  /// Hero tiles show the pulsing "В эфире" chip and a taller body.
  final bool live;

  /// Utility tiles are shorter and a touch calmer.
  final bool compact;

  @override
  State<_LaunchTile> createState() => _LaunchTileState();
}

class _LaunchTileState extends State<_LaunchTile> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final minHeight = widget.compact ? 132.0 : 184.0;
    final chipSize = widget.compact ? 46.0 : 54.0;

    return GestureDetector(
      onTapDown: (_) => setState(() => _pressed = true),
      onTapUp: (_) => setState(() => _pressed = false),
      onTapCancel: () => setState(() => _pressed = false),
      onTap: widget.onTap,
      child: AnimatedScale(
        scale: _pressed ? 0.97 : 1,
        duration: AppDurations.press,
        curve: AppCurves.glass,
        child: GlassCard(
          padding: EdgeInsets.zero,
          borderRadius: AppRadii.brXxl,
          glowColor: widget.accent,
          glowStrength: _pressed ? 0.5 : 0.34,
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: minHeight),
            child: Stack(
              children: [
                // A living neon wash over the glass — strongest at the icon
                // corner, fading out to bare glass at the opposite one.
                Positioned.fill(
                  child: IgnorePointer(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [
                            widget.accent.withValues(alpha: 0.34),
                            widget.secondAccent.withValues(alpha: 0.14),
                            Colors.transparent,
                          ],
                          stops: const [0.0, 0.5, 1.0],
                        ),
                      ),
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _NeonIconChip(
                            icon: widget.icon,
                            accent: widget.accent,
                            secondAccent: widget.secondAccent,
                            size: chipSize,
                          ),
                          if (widget.live)
                            _LivePulse(color: widget.accent)
                          else
                            Icon(Icons.arrow_outward_rounded,
                                size: 18,
                                color: colors.neonCyan.withValues(alpha: 0.8)),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.md),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            widget.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: (widget.compact
                                    ? context.texts.titleLarge
                                    : context.texts.headlineSmall)
                                ?.copyWith(fontWeight: FontWeight.w800),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            widget.subtitle,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: context.texts.bodySmall?.copyWith(
                                color: context.scheme.onSurfaceVariant,
                                height: 1.3),
                          ),
                          SizedBox(
                              height: widget.compact
                                  ? AppSpacing.sm
                                  : AppSpacing.md),
                          Row(
                            children: [
                              ShaderMask(
                                shaderCallback: (bounds) => LinearGradient(
                                  colors: [widget.accent, widget.secondAccent],
                                ).createShader(bounds),
                                child: Text(
                                  widget.compact ? 'Открыть' : 'Начать',
                                  style: context.texts.labelLarge?.copyWith(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w800),
                                ),
                              ),
                              const SizedBox(width: 4),
                              AnimatedSlide(
                                offset: Offset(_pressed ? 0.4 : 0, 0),
                                duration: AppDurations.fast,
                                child: Icon(Icons.arrow_forward_rounded,
                                    size: 18, color: widget.accent),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A rounded "frosted-on-void" chip holding a neon-gradient icon, lit by a soft
/// bloom in [accent] — the signature quick-launch glyph treatment.
class _NeonIconChip extends StatelessWidget {
  const _NeonIconChip({
    required this.icon,
    required this.accent,
    required this.secondAccent,
    required this.size,
  });

  final IconData icon;
  final Color accent;
  final Color secondAccent;
  final double size;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: AppRadii.brLg,
        color: context.scheme.surface.withValues(alpha: 0.55),
        border: Border.all(color: colors.glassBorder),
        boxShadow: AppShadows.glow(accent, strength: 0.55),
      ),
      child: ShaderMask(
        shaderCallback: (bounds) => LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [accent, secondAccent],
        ).createShader(bounds),
        child: Icon(icon, size: size * 0.52, color: Colors.white),
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
