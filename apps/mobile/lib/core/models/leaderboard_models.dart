/// Mirrors `packages/shared-types/src/leaderboard.ts` — a ranking of users by a
/// derivable metric (gifts received · coin balance · days held in Top),
/// computed on read by `GET /leaderboard?metric=`.
library;

/// `leaderboardMetricSchema` — `'gifts' | 'coins' | 'top'`.
enum LeaderboardMetric {
  gifts('gifts'),
  coins('coins'),
  top('top');

  const LeaderboardMetric(this.wire);
  final String wire;

  static LeaderboardMetric fromWire(String? value) => LeaderboardMetric.values
      .firstWhere((e) => e.wire == value, orElse: () => LeaderboardMetric.gifts);
}

/// `leaderboardEntrySchema` — one ranked row.
class LeaderboardEntry {
  const LeaderboardEntry({
    required this.rank,
    required this.userId,
    required this.nickname,
    required this.avatarUrl,
    required this.isPremium,
    required this.score,
  });

  /// 1-based position.
  final int rank;
  final String userId;
  final String nickname;
  final String? avatarUrl;
  final bool isPremium;

  /// Metric-specific score (received-gift coin value · coin balance · days in Top).
  final int score;

  factory LeaderboardEntry.fromJson(Map<String, dynamic> json) => LeaderboardEntry(
        rank: (json['rank'] as num?)?.toInt() ?? 0,
        userId: json['userId'] as String? ?? '',
        nickname: json['nickname'] as String? ?? '',
        avatarUrl: json['avatarUrl'] as String?,
        isPremium: json['isPremium'] as bool? ?? false,
        score: (json['score'] as num?)?.toInt() ?? 0,
      );
}

/// `leaderboardResponseSchema` — `{ metric, entries, me? }`.
class LeaderboardResponse {
  const LeaderboardResponse({
    required this.metric,
    required this.entries,
    this.me,
  });

  final LeaderboardMetric metric;
  final List<LeaderboardEntry> entries;

  /// The caller's own rank, if they're not already in the returned slice.
  final LeaderboardEntry? me;

  factory LeaderboardResponse.fromJson(Map<String, dynamic> json) {
    final rawEntries = (json['entries'] as List?) ?? const [];
    return LeaderboardResponse(
      metric: LeaderboardMetric.fromWire(json['metric'] as String?),
      entries: rawEntries
          .map((e) => LeaderboardEntry.fromJson(e as Map<String, dynamic>))
          .toList(growable: false),
      me: json['me'] != null
          ? LeaderboardEntry.fromJson(json['me'] as Map<String, dynamic>)
          : null,
    );
  }
}
