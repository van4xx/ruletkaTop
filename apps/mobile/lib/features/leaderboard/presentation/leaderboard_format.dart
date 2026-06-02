import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/models/models.dart';
import '../../../core/theme/theme.dart';

/// Presentation helpers for the leaderboard: metric labels, score formatting
/// (with the right unit per metric) and podium medal accents. Russian-first.
abstract final class LeaderboardFormat {
  static final NumberFormat _number = NumberFormat.decimalPattern('ru');

  /// The tab label for a metric.
  static String metricLabel(LeaderboardMetric m) => switch (m) {
        LeaderboardMetric.gifts => 'Подарки',
        LeaderboardMetric.coins => 'Монеты',
        LeaderboardMetric.top => 'Топ',
      };

  /// The score rendered with its metric-specific unit:
  ///  * gifts → received-gift coin value (coins)
  ///  * coins → coin balance (coins)
  ///  * top   → cumulative days held in the Top feed
  static String score(LeaderboardMetric m, int score) {
    final n = _number.format(score);
    return switch (m) {
      LeaderboardMetric.gifts || LeaderboardMetric.coins => n,
      LeaderboardMetric.top => '$n ${_plural(score, 'день', 'дня', 'дней')}',
    };
  }

  /// The small icon shown next to a score (coin vs trophy).
  static IconData scoreIcon(LeaderboardMetric m) => switch (m) {
        LeaderboardMetric.gifts => Icons.card_giftcard_rounded,
        LeaderboardMetric.coins => Icons.monetization_on_rounded,
        LeaderboardMetric.top => Icons.emoji_events_rounded,
      };

  /// Empty-state hint per metric.
  static String emptyHint(LeaderboardMetric m) => switch (m) {
        LeaderboardMetric.gifts =>
          'Здесь появятся те, кто получает больше всего подарков.',
        LeaderboardMetric.coins =>
          'Здесь появятся обладатели самых больших балансов.',
        LeaderboardMetric.top =>
          'Здесь появятся те, кто дольше всех держится в Топе.',
      };

  /// The medal accent for a 1-based podium [rank] (1·2·3); falls back to the
  /// neutral violet for anything else.
  static Color medal(BuildContext context, int rank) {
    final colors = context.colors;
    return switch (rank) {
      1 => colors.warning, // gold
      2 => const Color(0xFFC7CBD6), // silver
      3 => const Color(0xFFCD8A52), // bronze
      _ => colors.neonViolet,
    };
  }

  static String _plural(int n, String one, String few, String many) {
    final mod10 = n % 10;
    final mod100 = n % 100;
    if (mod10 == 1 && mod100 != 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  }
}
