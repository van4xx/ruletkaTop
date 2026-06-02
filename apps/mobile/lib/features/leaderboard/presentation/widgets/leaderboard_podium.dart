import 'package:flutter/material.dart';

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../leaderboard_format.dart';

/// The neon podium for the top-3 leaderboard entries: #1 centered and raised,
/// #2 left and #3 right, each with a [NeonAvatar], medal-tinted rank badge,
/// nickname and score. Gracefully renders fewer than three.
class LeaderboardPodium extends StatelessWidget {
  const LeaderboardPodium({
    super.key,
    required this.entries,
    required this.metric,
    required this.onTapUser,
    this.selfId,
  });

  /// The top-3 (1..3); may contain 1 or 2 when the board is short.
  final List<LeaderboardEntry> entries;
  final LeaderboardMetric metric;
  final void Function(String userId) onTapUser;
  final String? selfId;

  LeaderboardEntry? _at(int rank) {
    for (final e in entries) {
      if (e.rank == rank) return e;
    }
    // Fall back to positional order if ranks aren't 1-based as expected.
    final idx = rank - 1;
    return idx >= 0 && idx < entries.length ? entries[idx] : null;
  }

  @override
  Widget build(BuildContext context) {
    final first = _at(1);
    final second = _at(2);
    final third = _at(3);

    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: second == null
              ? const SizedBox.shrink()
              : _Pillar(
                  entry: second,
                  metric: metric,
                  avatarSize: 64,
                  isSelf: selfId != null && second.userId == selfId,
                  onTap: () => onTapUser(second.userId),
                ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: first == null
              ? const SizedBox.shrink()
              : _Pillar(
                  entry: first,
                  metric: metric,
                  avatarSize: 84,
                  crowned: true,
                  isSelf: selfId != null && first.userId == selfId,
                  onTap: () => onTapUser(first.userId),
                ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: third == null
              ? const SizedBox.shrink()
              : _Pillar(
                  entry: third,
                  metric: metric,
                  avatarSize: 64,
                  isSelf: selfId != null && third.userId == selfId,
                  onTap: () => onTapUser(third.userId),
                ),
        ),
      ],
    );
  }
}

class _Pillar extends StatelessWidget {
  const _Pillar({
    required this.entry,
    required this.metric,
    required this.avatarSize,
    required this.onTap,
    this.crowned = false,
    this.isSelf = false,
  });

  final LeaderboardEntry entry;
  final LeaderboardMetric metric;
  final double avatarSize;
  final VoidCallback onTap;
  final bool crowned;
  final bool isSelf;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final medal = LeaderboardFormat.medal(context, entry.rank);

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (crowned)
            Icon(Icons.emoji_events_rounded, color: medal, size: 22)
          else
            const SizedBox(height: 22),
          const SizedBox(height: AppSpacing.xs),
          Stack(
            alignment: Alignment.bottomCenter,
            clipBehavior: Clip.none,
            children: [
              NeonAvatar(
                imageUrl: entry.avatarUrl,
                name: entry.nickname,
                size: avatarSize,
                glow: crowned || entry.isPremium,
              ),
              Positioned(
                bottom: -6,
                child: _RankBadge(rank: entry.rank, color: medal),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            entry.nickname,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: context.texts.titleSmall?.copyWith(
              color: isSelf ? colors.neonViolet : context.scheme.onSurface,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 2),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(LeaderboardFormat.scoreIcon(metric), size: 13, color: medal),
              const SizedBox(width: 3),
              Flexible(
                child: Text(
                  LeaderboardFormat.score(metric, entry.score),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.texts.labelMedium
                      ?.copyWith(color: context.scheme.onSurfaceVariant),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A circular, medal-tinted rank number sitting under a podium avatar.
class _RankBadge extends StatelessWidget {
  const _RankBadge({required this.rank, required this.color});

  final int rank;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 24,
      height: 24,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        border: Border.all(color: context.scheme.surface, width: 2),
        boxShadow: AppShadows.glow(color, strength: 0.5),
      ),
      child: Text(
        '$rank',
        style: context.texts.labelSmall?.copyWith(
          color: Colors.black.withValues(alpha: 0.8),
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}
