import 'package:flutter/material.dart';

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';

/// Per-rarity visual tokens (label + accent color) for gift cards/chips.
/// Resolved against the active theme's neon palette so it tracks light/dark.
class RarityStyle {
  const RarityStyle({required this.label, required this.color});
  final String label;
  final Color color;

  static RarityStyle of(BuildContext context, Rarity rarity) {
    final colors = context.colors;
    return switch (rarity) {
      Rarity.common =>
        RarityStyle(label: 'Обычные', color: context.scheme.onSurfaceVariant),
      Rarity.rare => RarityStyle(label: 'Редкие', color: colors.neonCyan),
      Rarity.epic => RarityStyle(label: 'Эпические', color: colors.neonViolet),
      Rarity.legendary =>
        RarityStyle(label: 'Легендарные', color: colors.warning),
    };
  }
}
