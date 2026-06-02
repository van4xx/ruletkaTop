import 'package:flutter/material.dart';

import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';

/// A single stat for the [ProfileStatsStrip].
class ProfileStat {
  const ProfileStat({
    required this.icon,
    required this.value,
    required this.label,
    this.accent,
    this.loading = false,
  });

  final IconData icon;
  final String value;
  final String label;

  /// Optional accent color for the icon + value (defaults to onSurface).
  final Color? accent;

  /// Render the value as a shimmer while the backing data loads.
  final bool loading;
}

/// A compact, glassy stats strip — a row of evenly-sized stat cells separated
/// by hairline dividers. Mirrors the web profile's "gifts value / views /
/// friends / top" summary band. Lays out 2–4 cells responsively.
class ProfileStatsStrip extends StatelessWidget {
  const ProfileStatsStrip({super.key, required this.stats});

  final List<ProfileStat> stats;

  @override
  Widget build(BuildContext context) {
    if (stats.isEmpty) return const SizedBox.shrink();

    return GlassCard(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm, vertical: AppSpacing.lg),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            for (var i = 0; i < stats.length; i++) ...[
              if (i > 0)
                VerticalDivider(
                  width: 1,
                  thickness: 1,
                  color: context.colors.glassBorder,
                ),
              Expanded(child: _StatCell(stat: stats[i])),
            ],
          ],
        ),
      ),
    );
  }
}

class _StatCell extends StatelessWidget {
  const _StatCell({required this.stat});

  final ProfileStat stat;

  @override
  Widget build(BuildContext context) {
    final accent = stat.accent ?? context.scheme.onSurface;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xs),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(stat.icon, size: 18, color: accent),
          const SizedBox(height: 6),
          if (stat.loading)
            const ShimmerBox(width: 32, height: 18)
          else
            Text(
              stat.value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: context.texts.titleMedium?.copyWith(color: accent),
            ),
          const SizedBox(height: 2),
          Text(
            stat.label,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: context.texts.labelSmall
                ?.copyWith(color: context.scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}
