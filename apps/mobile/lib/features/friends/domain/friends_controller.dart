import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../../../core/socket/socket.dart';
import '../data/friends_repository.dart';

/// Immutable view-state for the friends list: the loaded friends (already
/// merged with any live presence overrides), cursor-pagination bookkeeping and
/// a non-blocking "loading more" flag.
@immutable
class FriendsState {
  const FriendsState({
    this.friends = const [],
    this.nextCursor,
    this.hasMore = false,
    this.isLoadingMore = false,
  });

  final List<FriendSummary> friends;
  final String? nextCursor;
  final bool hasMore;
  final bool isLoadingMore;

  /// Friends currently shown as online/away/in-call (anything but offline).
  int get onlineCount =>
      friends.where((f) => f.status != OnlineStatus.offline).length;

  FriendsState copyWith({
    List<FriendSummary>? friends,
    String? nextCursor,
    bool? hasMore,
    bool? isLoadingMore,
    bool clearCursor = false,
  }) =>
      FriendsState(
        friends: friends ?? this.friends,
        nextCursor: clearCursor ? null : (nextCursor ?? this.nextCursor),
        hasMore: hasMore ?? this.hasMore,
        isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      );
}

/// Owns the friends list and layers live presence on top.
///
/// * Initial build loads the first page (`GET /friends`), then subscribes the
///   socket to every friend's presence (`presence:subscribe`) and listens for
///   `presence:online` / `presence:offline` to patch statuses in place.
/// * [loadMore] appends subsequent cursor pages (and re-subscribes the new ids).
/// * [refresh] re-fetches from scratch.
/// * [remove] / [block] optimistically drop a row and reconcile on failure.
class FriendsController extends AsyncNotifier<FriendsState> {
  FriendsRepository get _repo => ref.read(friendsRepositoryProvider);
  SocketService get _socket => ref.read(socketServiceProvider);

  /// Live presence overrides keyed by user id, applied over each fetched page
  /// so a status update survives list rebuilds.
  final Map<String, OnlineStatus> _presence = {};

  static const int _pageSize = 30;

  @override
  Future<FriendsState> build() async {
    // Subscribe presence listeners exactly ONCE per provider lifetime and tear
    // them down on dispose. `build` runs once (the provider isn't recreated for
    // a pull-to-refresh — that calls [_fetchFirstPage] only), so this never
    // leaks duplicate listeners.
    final disposers = <VoidCallback>[
      _socket.onPresenceOnline(_onPresence),
      _socket.onPresenceOffline(_onPresence),
    ];
    ref.onDispose(() {
      for (final d in disposers) {
        d();
      }
    });

    return _fetchFirstPage();
  }

  /// Load the first page of friends (presence-overlaid + subscribed). Pure data
  /// fetch — no listener wiring — so [refresh] can re-run it without leaking
  /// socket subscriptions.
  Future<FriendsState> _fetchFirstPage() async {
    final page = await _repo.listFriends(limit: _pageSize);
    final friends = _applyPresence(page.items);
    _subscribePresence(friends);
    return FriendsState(
      friends: friends,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    );
  }

  /// Apply any known live-presence overrides over a freshly-fetched list.
  List<FriendSummary> _applyPresence(List<FriendSummary> items) {
    if (_presence.isEmpty) return items;
    return [
      for (final f in items)
        _presence.containsKey(f.profile.id)
            ? FriendSummary(
                friendshipId: f.friendshipId,
                profile: f.profile,
                status: _presence[f.profile.id]!,
                since: f.since,
              )
            : f,
    ];
  }

  void _subscribePresence(List<FriendSummary> friends) {
    if (friends.isEmpty) return;
    _socket.presenceSubscribe(friends.map((f) => f.profile.id).toList());
  }

  /// Patch a single friend's status from a `presence:*` event.
  void _onPresence(PresencePayload p) {
    _presence[p.userId] = p.status;
    final current = state.value;
    if (current == null) return;
    var changed = false;
    final updated = [
      for (final f in current.friends)
        if (f.profile.id == p.userId)
          () {
            changed = true;
            return FriendSummary(
              friendshipId: f.friendshipId,
              profile: f.profile,
              status: p.status,
              since: f.since,
            );
          }()
        else
          f,
    ];
    if (changed) state = AsyncData(current.copyWith(friends: updated));
  }

  /// Fetch and append the next cursor page (no full-screen spinner).
  Future<void> loadMore() async {
    final current = state.value;
    if (current == null ||
        !current.hasMore ||
        current.isLoadingMore ||
        current.nextCursor == null) {
      return;
    }
    state = AsyncData(current.copyWith(isLoadingMore: true));
    try {
      final page =
          await _repo.listFriends(cursor: current.nextCursor, limit: _pageSize);
      final added = _applyPresence(page.items);
      _subscribePresence(added);
      state = AsyncData(current.copyWith(
        friends: [...current.friends, ...added],
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        isLoadingMore: false,
      ));
    } catch (_) {
      // Keep what we have; just clear the spinner so the user can retry.
      final latest = state.value ?? current;
      state = AsyncData(latest.copyWith(isLoadingMore: false));
    }
  }

  /// Pull-to-refresh: reload the first page from scratch WITHOUT re-running
  /// `build` (which would re-subscribe the presence listeners and leak them).
  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_fetchFirstPage);
  }

  /// Optimistically remove a friendship (or decline a request) and reconcile.
  Future<void> remove(String friendshipId) async {
    final current = state.value;
    if (current == null) return;
    final previous = current.friends;
    state = AsyncData(current.copyWith(
      friends: previous.where((f) => f.friendshipId != friendshipId).toList(),
    ));
    try {
      await _repo.removeFriendship(friendshipId);
    } catch (_) {
      // Restore on failure.
      final latest = state.value ?? current;
      state = AsyncData(latest.copyWith(friends: previous));
      rethrow;
    }
  }

  /// Block a user, optimistically dropping their row from the list.
  Future<void> block(String userId) async {
    final current = state.value;
    if (current == null) {
      await _repo.block(userId);
      return;
    }
    final previous = current.friends;
    state = AsyncData(current.copyWith(
      friends: previous.where((f) => f.profile.id != userId).toList(),
    ));
    try {
      await _repo.block(userId);
    } catch (_) {
      final latest = state.value ?? current;
      state = AsyncData(latest.copyWith(friends: previous));
      rethrow;
    }
  }
}

/// The friends list provider (async, with live presence baked in).
final friendsControllerProvider =
    AsyncNotifierProvider<FriendsController, FriendsState>(FriendsController.new);
