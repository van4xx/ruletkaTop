import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import 'economy_providers.dart';

/// ─────────────────────────────────────────────────────────────────────────
/// A hydrated view of the Top feed for the full `/top` screen.
///
/// `GET /top` (via [topFeedProvider]) returns bare [TopPlacement]s — each only
/// carries a `userId`. To render avatars + nicknames the screen needs the
/// placed users' public profiles, so this provider resolves them concurrently
/// (best-effort: a placement whose profile fails to load is dropped) and splits
/// the result into the two lanes, ranked by priority within each.
///
/// Kept separate from the dashboard's own hydrated feed so the economy feature
/// owns its data path; reuses the economy repository + the shared API client.
/// ─────────────────────────────────────────────────────────────────────────

/// A Top placement decorated with the placed user's [PublicProfile].
class TopFeedEntry {
  const TopFeedEntry({required this.placement, required this.profile});

  final TopPlacement placement;
  final PublicProfile profile;

  String get userId => placement.userId;
}

/// The hydrated feed split into its two lanes (highest spend first per lane —
/// rank within a lane is `index + 1`).
class TopFeedView {
  const TopFeedView({required this.left, required this.right});

  final List<TopFeedEntry> left;
  final List<TopFeedEntry> right;

  int get total => left.length + right.length;
  bool get isEmpty => left.isEmpty && right.isEmpty;

  static const empty = TopFeedView(left: [], right: []);
}

/// Resolves [topFeedProvider]'s placements to profiles and buckets them by lane.
final topFeedViewProvider = FutureProvider.autoDispose<TopFeedView>((ref) async {
  final feed = await ref.watch(topFeedProvider.future);
  final placements = [...feed.left, ...feed.right];
  if (placements.isEmpty) return TopFeedView.empty;

  final api = ref.watch(apiClientProvider);

  // Deduplicate the user ids (a user could appear once per lane) and fetch
  // their profiles concurrently.
  final ids = {for (final p in placements) p.userId}.toList(growable: false);
  final profiles = await Future.wait(
    ids.map((id) async {
      try {
        return await api.profileById(id);
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

  List<TopFeedEntry> hydrate(List<TopPlacement> lane) {
    final entries = <TopFeedEntry>[];
    for (final placement in lane) {
      final profile = byId[placement.userId];
      if (profile == null) continue; // drop un-hydratable entries
      entries.add(TopFeedEntry(placement: placement, profile: profile));
    }
    entries.sort((a, b) => b.placement.priority.compareTo(a.placement.priority));
    return entries;
  }

  return TopFeedView(left: hydrate(feed.left), right: hydrate(feed.right));
});
