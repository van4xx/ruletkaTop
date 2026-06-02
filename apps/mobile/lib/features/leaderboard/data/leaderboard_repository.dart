import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/di/di.dart';
import '../../../core/models/models.dart';

/// Thin data layer over the foundation's [ApiClient] for the leaderboard,
/// sourced from the REST contract (`@ruletka/shared-types` + the NestJS
/// `/leaderboard` controller):
///
///   GET /leaderboard?metric=gifts|coins|top&limit= → LeaderboardResponse
///
/// The ranking is derived on read from existing collections (gifts received ·
/// coin balance · days held in Top), so no new tracking is required server-side.
class LeaderboardRepository {
  LeaderboardRepository(this._api);

  final ApiClient _api;

  /// Fetch the ranking for [metric] (capped at [limit] entries).
  Future<LeaderboardResponse> fetch(LeaderboardMetric metric, {int? limit}) =>
      _api.leaderboard(metric: metric, limit: limit);
}

/// DI: the leaderboard repository, built on the shared [apiClientProvider].
final leaderboardRepositoryProvider = Provider<LeaderboardRepository>((ref) {
  return LeaderboardRepository(ref.watch(apiClientProvider));
});
