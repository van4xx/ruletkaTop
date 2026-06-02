import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/models.dart';
import '../data/leaderboard_repository.dart';

/// Loads the leaderboard for a single metric, family-keyed by
/// [LeaderboardMetric]. Switching metric tabs reads a different family instance,
/// so each tab caches its own result independently.
class LeaderboardController extends AsyncNotifier<LeaderboardResponse> {
  /// Riverpod 3.x family notifiers receive their family key (the chosen metric)
  /// via the constructor; `build()` is parameterless.
  LeaderboardController(this._metric);

  final LeaderboardMetric _metric;

  static const int _limit = 50;

  LeaderboardRepository get _repo => ref.read(leaderboardRepositoryProvider);

  @override
  Future<LeaderboardResponse> build() => _repo.fetch(_metric, limit: _limit);

  /// Pull-to-refresh: re-fetch this metric's ranking.
  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() => _repo.fetch(_metric, limit: _limit));
  }
}

/// The leaderboard provider, family-keyed by [LeaderboardMetric] (auto-disposed
/// so an unused tab's data is released).
final leaderboardControllerProvider = AsyncNotifierProvider.autoDispose
    .family<LeaderboardController, LeaderboardResponse, LeaderboardMetric>(
  LeaderboardController.new,
);
