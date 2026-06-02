// Hide Flutter's Badge widget: this file works with the contract `Badge` enum.
import 'package:flutter/material.dart' hide Badge;

import '../models/models.dart';
import '../theme/theme.dart';

/// A tiny status/identity pill for the contract [Badge] set (premium, verified,
/// top, staff). Color-coded with the neon palette; compact enough to sit inline
/// next to a nickname.
class UserBadgePill extends StatelessWidget {
  const UserBadgePill({super.key, required this.badge});

  final Badge badge;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final (label, icon, color) = switch (badge) {
      Badge.premium => ('Premium', Icons.workspace_premium_rounded, colors.warning),
      Badge.verified => ('Verified', Icons.verified_rounded, colors.neonCyan),
      Badge.top => ('Top', Icons.trending_up_rounded, colors.neonMagenta),
      Badge.staff => ('Staff', Icons.shield_rounded, colors.neonViolet),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: AppRadii.brPill,
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: color),
          const SizedBox(width: 4),
          Text(
            label,
            style: context.texts.labelSmall?.copyWith(color: color, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

/// A rarity chip for gifts (common/rare/epic/legendary), tinted per tier.
class RarityChip extends StatelessWidget {
  const RarityChip({super.key, required this.rarity});

  final Rarity rarity;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final (label, color) = switch (rarity) {
      Rarity.common => ('Обычный', context.scheme.onSurfaceVariant),
      Rarity.rare => ('Редкий', colors.neonCyan),
      Rarity.epic => ('Эпический', colors.neonViolet),
      Rarity.legendary => ('Легендарный', colors.warning),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.16),
        borderRadius: AppRadii.brPill,
      ),
      child: Text(
        label,
        style: context.texts.labelSmall?.copyWith(color: color, fontWeight: FontWeight.w700),
      ),
    );
  }
}

/// A section header row: a bold title with an optional trailing action
/// (e.g. "See all"). Reused across dashboard/feature list sections.
class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title, this.trailing, this.padding});

  final String title;
  final Widget? trailing;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding ?? const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      child: Row(
        children: [
          Expanded(child: Text(title, style: context.texts.titleMedium)),
          ?trailing,
        ],
      ),
    );
  }
}
