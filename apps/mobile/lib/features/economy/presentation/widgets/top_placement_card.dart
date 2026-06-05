// Hide Flutter's Badge widget: this card reads the contract `Badge` enum.
import 'package:flutter/material.dart' hide Badge;

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../../domain/top_feed_view.dart';
import '../economy_format.dart';

/// A single ranked Top placement row: a rank medallion (gold/silver/bronze for
/// the podium), a ringed [NeonAvatar], the nickname (+ verified tick), the
/// coins spent and the remaining time. Podium rows carry a warm corner glow and
/// a brighter glass. Taps through to the profile. Mirrors the web's `TopCard`.
class TopPlacementCard extends StatelessWidget {
  const TopPlacementCard({
    super.key,
    required this.entry,
    required this.rank,
    required this.onTap,
  });

  final TopFeedEntry entry;
  final int rank;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final profile = entry.profile;
    final isVerified = profile.badges.contains(Badge.verified);
    final podium = rank <= 3;
    // The leader gets a gold halo; 2/3 a subtle one.
    final podiumColor = switch (rank) {
      1 => colors.warning,
      2 => const Color(0xFFB9C2D0),
      3 => const Color(0xFFCB8E5A),
      _ => null,
    };

    return GlassCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      borderRadius: AppRadii.brXl,
      blurSigma: 0,
      intensity: podium ? 1.12 : 0.95,
      onTap: onTap,
      child: Stack(
        children: [
          if (podium && podiumColor != null)
            Positioned(
              top: -22,
              left: -22,
              child: IgnorePointer(
                child: Container(
                  width: 76,
                  height: 76,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      colors: [
                        podiumColor.withValues(alpha: rank == 1 ? 0.28 : 0.18),
                        Colors.transparent,
                      ],
                    ),
                  ),
                ),
              ),
            ),
          Row(
            children: [
              _RankBadge(rank: rank),
              const SizedBox(width: AppSpacing.md),
              NeonAvatar(
                imageUrl: profile.avatarUrl,
                name: profile.nickname,
                size: 48,
                ring: profile.isPremium,
                glow: profile.isPremium,
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            profile.nickname,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: context.texts.titleSmall?.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        if (isVerified) ...[
                          const SizedBox(width: 4),
                          Icon(
                            Icons.verified_rounded,
                            size: 15,
                            color: colors.neonCyan,
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        Icon(
                          Icons.monetization_on_rounded,
                          size: 14,
                          color: colors.warning,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          EconomyFormat.number(entry.placement.coinsSpent),
                          style: AppTypography.stat(
                            fontSize: 13,
                            fontWeight: FontWeight.w800,
                            color: context.scheme.onSurface,
                          ),
                        ),
                        const SizedBox(width: AppSpacing.md),
                        Icon(
                          Icons.schedule_rounded,
                          size: 13,
                          color: context.scheme.onSurfaceVariant,
                        ),
                        const SizedBox(width: 4),
                        Flexible(
                          child: Text(
                            EconomyFormat.timeLeft(entry.placement.expiresAt),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: context.texts.bodySmall?.copyWith(
                              color: context.scheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Icon(
                Icons.chevron_right_rounded,
                color: context.scheme.onSurfaceVariant,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A circular rank chip. The top three get a tinted gradient + glow; the rest a
/// neutral glass chip. The leader carries a tiny crown.
class _RankBadge extends StatelessWidget {
  const _RankBadge({required this.rank});

  final int rank;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    // Podium tints: 1 = gold, 2 = silver, 3 = bronze.
    final (List<Color>? gradient, Color fg) = switch (rank) {
      1 => ([const Color(0xFFFFD76A), colors.warning], const Color(0xFF1A1206)),
      2 => (
        [const Color(0xFFD8DEE9), const Color(0xFF9AA4B2)],
        const Color(0xFF14171C),
      ),
      3 => (
        [const Color(0xFFE0A56A), const Color(0xFFB9763C)],
        const Color(0xFF1A0F06),
      ),
      _ => (null, context.scheme.onSurfaceVariant),
    };

    return Container(
      width: 34,
      height: 34,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: gradient != null ? LinearGradient(colors: gradient) : null,
        color: gradient == null ? context.scheme.surfaceContainerHighest : null,
        border: gradient == null ? Border.all(color: colors.glassBorder) : null,
        boxShadow: rank == 1
            ? AppShadows.glow(colors.warning, strength: 0.5)
            : null,
      ),
      child: rank == 1
          ? Icon(Icons.emoji_events_rounded, size: 17, color: fg)
          : Text(
              '$rank',
              style: context.texts.labelLarge?.copyWith(
                color: fg,
                fontWeight: FontWeight.w800,
              ),
            ),
    );
  }
}
