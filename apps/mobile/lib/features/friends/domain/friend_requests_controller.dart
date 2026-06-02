import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../../../core/socket/socket.dart';
import '../data/friends_repository.dart';
import 'friends_controller.dart';

/// Owns the caller's pending friend requests, loaded from the real
/// `GET /friends/requests` endpoint (`{ incoming, outgoing }`).
///
/// * Incoming = people who asked you → [accept] (`POST /friends/:id/accept`) or
///   [decline] (`DELETE /friends/:id`), keyed by `friendshipId`.
/// * Outgoing = requests you sent that are still pending → [cancel]
///   (`DELETE /friends/:id`).
///
/// A live `notif:new` (kind `friend_request`) over the socket triggers a
/// [refresh] so a freshly-arrived incoming request shows up without a manual
/// reload. The actionable mutations optimistically drop the row and reconcile
/// on failure; accepting also refreshes the accepted-friends list.
class FriendRequestsController extends AsyncNotifier<FriendRequestsResponse> {
  FriendsRepository get _repo => ref.read(friendsRepositoryProvider);
  SocketService get _socket => ref.read(socketServiceProvider);

  @override
  Future<FriendRequestsResponse> build() async {
    final disposer = _socket.onNotification(_onNotification);
    ref.onDispose(disposer);
    return _repo.listRequests();
  }

  void _onNotification(AppNotification n) {
    if (n.kind != NotificationKind.friendRequest) return;
    // A new incoming request may have landed — reload the inbox quietly.
    refresh();
  }

  /// Reload both lists from the server (used for pull-to-refresh + live events).
  Future<void> refresh() async {
    state = await AsyncValue.guard(_repo.listRequests);
  }

  /// Accept an incoming request. Optimistically removes it from [incoming] and
  /// refreshes the accepted-friends list on success. Rethrows [ApiException].
  Future<void> accept(String friendshipId) async {
    final current = state.value;
    await _mutate(
      friendshipId,
      () => _repo.acceptRequest(friendshipId),
      removeFrom: current,
    );
    // The new friendship is now visible in the accepted list.
    ref.read(friendsControllerProvider.notifier).refresh();
  }

  /// Decline an incoming request (same route as remove). Optimistic + reconcile.
  Future<void> decline(String friendshipId) async {
    await _mutate(
      friendshipId,
      () => _repo.removeFriendship(friendshipId),
      removeFrom: state.value,
    );
  }

  /// Cancel an outgoing (pending) request. Optimistic + reconcile.
  Future<void> cancel(String friendshipId) async {
    await _mutate(
      friendshipId,
      () => _repo.removeFriendship(friendshipId),
      removeFrom: state.value,
    );
  }

  /// Shared optimistic-removal helper: drop the row keyed by [friendshipId] from
  /// both lists, run [action], and restore the snapshot if it throws.
  Future<void> _mutate(
    String friendshipId,
    Future<void> Function() action, {
    required FriendRequestsResponse? removeFrom,
  }) async {
    if (removeFrom != null) {
      state = AsyncData(FriendRequestsResponse(
        incoming:
            removeFrom.incoming.where((r) => r.friendshipId != friendshipId).toList(),
        outgoing:
            removeFrom.outgoing.where((r) => r.friendshipId != friendshipId).toList(),
      ));
    }
    try {
      await action();
    } catch (_) {
      if (removeFrom != null) state = AsyncData(removeFrom);
      rethrow;
    }
  }

  /// Send an outgoing friend request to [recipientId]. Returns the created
  /// (pending) friendship and refreshes the outgoing list. Throws [ApiException]
  /// on failure (e.g. 409 if a relationship already exists).
  Future<Friendship> sendRequest(String recipientId) async {
    final friendship = await _repo.sendRequest(recipientId);
    await refresh();
    return friendship;
  }
}

/// The pending friend-requests provider (async, both directions).
final friendRequestsControllerProvider =
    AsyncNotifierProvider<FriendRequestsController, FriendRequestsResponse>(
        FriendRequestsController.new);

/// Convenience: the incoming-request count (for the friends app-bar badge).
/// Resolves to `0` while loading / on error so the badge stays quiet.
final friendRequestsCountProvider = Provider<int>((ref) {
  final async = ref.watch(friendRequestsControllerProvider);
  return async.value?.incoming.length ?? 0;
});
