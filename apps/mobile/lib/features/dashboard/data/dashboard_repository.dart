import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/di/di.dart';
import '../../../core/models/models.dart';

/// A Top-feed entry decorated with the placed user's [PublicProfile].
///
/// `GET /top` returns bare [TopPlacement]s (only a `userId`), so the dashboard
/// hydrates each with the user's public profile to render an avatar + nickname.
/// Hydration is best-effort: a placement whose profile fails to load is dropped
/// rather than blocking the whole feed.
class TopEntry {
  const TopEntry({required this.placement, required this.profile});

  final TopPlacement placement;
  final PublicProfile profile;

  String get userId => placement.userId;
}

/// The Top feed split into its two marquee lanes, ordered by priority (highest
/// spend first) within each lane — rank within a lane is `index + 1`.
class TopFeed {
  const TopFeed({required this.left, required this.right});

  final List<TopEntry> left;
  final List<TopEntry> right;

  int get total => left.length + right.length;
  bool get isEmpty => left.isEmpty && right.isEmpty;

  static const empty = TopFeed(left: [], right: []);
}

/// Data access for the dashboard hub. Stitches together the already-built REST
/// endpoints ([ApiEndpoints]) rather than introducing new ones, mirroring the
/// web's `use-dashboard` composition. Each method is independently awaited by a
/// focused provider so a slow section never blocks the rest of the hub.
class DashboardRepository {
  DashboardRepository(this._api);

  final ApiClient _api;

  /// The caller's rich public profile (avatar, premium, country, views).
  Future<PublicProfile> myProfile() => _api.myProfile();

  /// The caller's coin wallet.
  Future<Wallet> wallet() => _api.wallet();

  /// The caller's accepted friends (first page) with seeded presence.
  Future<List<FriendSummary>> friends() async {
    final page = await _api.friends(limit: 50);
    return page.items;
  }

  /// The most-recently-active conversations (first page).
  Future<List<Conversation>> conversations() async {
    final page = await _api.conversations(limit: 20);
    return page.items;
  }

  /// The live Top feed, hydrated with each placement's profile and split into
  /// the two lanes (ordered by priority within each).
  Future<TopFeed> topFeed() async {
    final placements = await _api.topFeed();
    if (placements.isEmpty) return TopFeed.empty;

    // Deduplicate the user ids we need to hydrate (a user could, in theory,
    // appear once per lane) and fetch their profiles concurrently.
    final ids = {for (final p in placements) p.userId}.toList(growable: false);
    final profiles = await Future.wait(
      ids.map((id) async {
        try {
          return await _api.profileById(id);
        } on ApiException {
          return null;
        }
      }),
    );
    final byId = <String, PublicProfile>{};
    for (var i = 0; i < ids.length; i++) {
      final profile = profiles[i];
      if (profile != null) byId[ids[i]] = profile;
    }

    final left = <TopEntry>[];
    final right = <TopEntry>[];
    for (final placement in placements) {
      final profile = byId[placement.userId];
      if (profile == null) continue; // drop un-hydratable entries
      final entry = TopEntry(placement: placement, profile: profile);
      (placement.lane == TopLane.left ? left : right).add(entry);
    }

    int byPriority(TopEntry a, TopEntry b) =>
        b.placement.priority.compareTo(a.placement.priority);
    left.sort(byPriority);
    right.sort(byPriority);

    return TopFeed(left: left, right: right);
  }
}

/// Provides the [DashboardRepository] over the shared [apiClientProvider].
final dashboardRepositoryProvider = Provider<DashboardRepository>((ref) {
  return DashboardRepository(ref.watch(apiClientProvider));
});
