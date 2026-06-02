// Hide Flutter's Badge widget so the contract `Badge` enum (via UserBadgePill)
// is unambiguous within this file's imports.
import 'package:flutter/material.dart' hide Badge;

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../leaderboard_format.dart';

/// A single ranked leaderboard row (for positions 4+): the rank number, a
/// [NeonAvatar], nickname (with a premium pill) and the metric score. The
/// caller's own row gets a violet-tinted highlight.
class LeaderboardRow extends StatelessWidget {
  const LeaderboardRow({
    super.key,
    required this.entry,
    required this.metric,
    required this.onTap,
    this.isSelf = false,
  });

  final LeaderboardEntry entry;
  final LeaderboardMetric metric;
  final VoidCallback onTap;
  final bool isSelf;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final accent = colors.neonViolet;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadii.brXl,
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: AppRadii.brXl,
            color: isSelf ? accent.withValues(alpha: 0.10) : Colors.transparent,
            border: Border.all(
              color: isSelf ? accent.withValues(alpha: 0.4) : colors.glassBorder,
            ),
          ),
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md, vertical: AppSpacing.sm),
          child: Row(
            children: [
              SizedBox(
                width: 28,
                child: Text(
                  '${entry.rank}',
                  textAlign: TextAlign.center,
                  style: context.texts.titleSmall?.copyWith(
                    color: context.scheme.onSurfaceVariant,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              NeonAvatar(
                imageUrl: entry.avatarUrl,
                name: entry.nickname,
                size: 44,
                ring: entry.isPremium,
                glow: false,
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Row(
                  children: [
                    Flexible(
                      child: Text(
                        entry.nickname,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.texts.titleSmall?.copyWith(
                          color: isSelf ? accent : context.scheme.onSurface,
                        ),
                      ),
                    ),
                    if (entry.isPremium) ...[
                      const SizedBox(width: AppSpacing.sm),
                      const UserBadgePill(badge: Badge.premium),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Icon(LeaderboardFormat.scoreIcon(metric),
                  size: 15, color: colors.warning),
              const SizedBox(width: 4),
              Text(
                LeaderboardFormat.score(metric, entry.score),
                style: context.texts.titleSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
