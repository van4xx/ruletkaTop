import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../../../core/socket/socket.dart';
import '../data/dashboard_repository.dart';

/// ─────────────────────────────────────────────────────────────────────────
/// Dashboard providers.
///
/// The hub composes several focused async providers (profile, wallet, top
/// feed, friends, chats) so each widget consumes only the slice it needs and
/// degrades on its own. Presence is layered on top of the friends list and
/// kept live over the socket, mirroring the web's `useOnlineFriends`.
/// ─────────────────────────────────────────────────────────────────────────

/// The caller's rich profile (avatar/premium/country/views).
final myProfileProvider = FutureProvider.autoDispose<PublicProfile>((ref) {
  return ref.watch(dashboardRepositoryProvider).myProfile();
});

/// The caller's coin balance.
final walletProvider = FutureProvider.autoDispose<Wallet>((ref) {
  return ref.watch(dashboardRepositoryProvider).wallet();
});

/// The hydrated, lane-split Top feed.
final topFeedProvider = FutureProvider.autoDispose<TopFeed>((ref) {
  return ref.watch(dashboardRepositoryProvider).topFeed();
});

/// The caller's accepted friends (with seeded presence).
final friendsProvider =
    FutureProvider.autoDispose<List<FriendSummary>>((ref) {
  return ref.watch(dashboardRepositoryProvider).friends();
});

/// The caller's recent conversations.
final recentChatsProvider =
    FutureProvider.autoDispose<List<Conversation>>((ref) {
  return ref.watch(dashboardRepositoryProvider).conversations();
});

/// A live presence map (`userId → OnlineStatus`). Seeded by [seedPresence]
/// (e.g. from the friends list) and kept current via the socket's
/// `presence:online` / `presence:offline` events. Subscribes the given ids on
/// the gateway so the server starts pushing updates for them.
///
/// This is a [Notifier] rather than a provider family so the whole app shares
/// one presence map (the friends widget seeds it; a profile screen can read
/// the same source of truth).
class PresenceNotifier extends Notifier<Map<String, OnlineStatus>> {
  SocketService get _socket => ref.read(socketServiceProvider);

  @override
  Map<String, OnlineStatus> build() {
    // Keep the live subscriptions for this notifier's lifetime.
    final disposeOnline = _socket.onPresenceOnline(_apply);
    final disposeOffline = _socket.onPresenceOffline(_apply);
    ref.onDispose(disposeOnline);
    ref.onDispose(disposeOffline);
    return const {};
  }

  void _apply(PresencePayload payload) {
    final next = Map<String, OnlineStatus>.from(state);
    next[payload.userId] = payload.status;
    state = next;
  }

  /// Merge in initial statuses (without clobbering fresher live values) and
  /// ask the gateway to start streaming presence for these ids.
  void seed(Map<String, OnlineStatus> seed, List<String> subscribeIds) {
    if (seed.isNotEmpty) {
      final next = Map<String, OnlineStatus>.from(seed)..addAll(state);
      state = next;
    }
    if (subscribeIds.isNotEmpty && _socket.isConnected) {
      _socket.presenceSubscribe(subscribeIds);
    }
  }

  /// The current status for [userId], or [fallback] when unknown.
  OnlineStatus statusOf(String userId,
          {OnlineStatus fallback = OnlineStatus.offline}) =>
      state[userId] ?? fallback;
}

/// The shared live presence map.
final presenceProvider =
    NotifierProvider<PresenceNotifier, Map<String, OnlineStatus>>(
        PresenceNotifier.new);

/// Statuses worth surfacing in the "online friends" strip.
const Set<OnlineStatus> _liveStatuses = {
  OnlineStatus.online,
  OnlineStatus.away,
  OnlineStatus.inCall,
};

/// Ranking weight so the most "joinable" friends come first.
const Map<OnlineStatus, int> _statusWeight = {
  OnlineStatus.online: 0,
  OnlineStatus.away: 1,
  OnlineStatus.inCall: 2,
};

/// Accepted friends decorated with live presence, filtered to those reachable
/// right now and sorted online → away → in-call. Returns the friends list with
/// the resolved status alongside, so the widget can render the right dot.
typedef OnlineFriend = ({FriendSummary friend, OnlineStatus status});

final onlineFriendsProvider = Provider.autoDispose<List<OnlineFriend>>((ref) {
  final friends = ref.watch(friendsProvider).value ?? const [];
  final presence = ref.watch(presenceProvider);

  final ranked = friends
      .map((f) => (friend: f, status: presence[f.profile.id] ?? f.status))
      .where((e) => _liveStatuses.contains(e.status))
      .toList(growable: false)
    ..sort((a, b) =>
        (_statusWeight[a.status] ?? 9).compareTo(_statusWeight[b.status] ?? 9));

  return ranked;
});

/// Sum of unread across all conversations — drives the chats widget badge.
final unreadTotalProvider = Provider.autoDispose<int>((ref) {
  final chats = ref.watch(recentChatsProvider).value ?? const [];
  return chats.fold<int>(0, (sum, c) => sum + c.unreadCount);
});

/// A public profile by id, fetched lazily and cached. Shared by the recent-
/// chats preview (to resolve the peer's avatar/nickname) and any other surface
/// that needs a single profile without the full dashboard repository.
final profileByIdProvider =
    FutureProvider.autoDispose.family<PublicProfile, String>((ref, id) {
  return ref.watch(apiClientProvider).profileById(id);
});
