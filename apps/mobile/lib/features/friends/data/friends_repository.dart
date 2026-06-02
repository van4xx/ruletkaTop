import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/di/di.dart';
import '../../../core/models/models.dart';

/// Thin data layer over the foundation's [ApiClient] for the friends domain,
/// sourced from the REST contract (`@ruletka/shared-types` + the NestJS
/// `/friends` controller):
///
///   GET    /friends                 → `Paginated<FriendSummary>` (accepted)
///   POST   /friends/request         → Friendship               (send a request)
///   POST   /friends/:id/accept      → Friendship               (accept)
///   DELETE /friends/:id             → 204                       (remove / decline)
///   POST   /blocks                  → 204                       (block a user)
///
/// The presentation/domain layers depend on this so the API surface stays in
/// one place and is trivially fakeable in tests.
class FriendsRepository {
  FriendsRepository(this._api);

  final ApiClient _api;

  /// A page of the caller's accepted friends (with presence).
  Future<Paginated<FriendSummary>> listFriends({String? cursor, int? limit}) =>
      _api.friends(cursor: cursor, limit: limit);

  /// The caller's pending friend requests, both directions
  /// (`{ incoming, outgoing }`).
  Future<FriendRequestsResponse> listRequests() => _api.friendRequests();

  /// Send a friend request to [recipientId]. Returns the created (pending)
  /// friendship.
  Future<Friendship> sendRequest(String recipientId) =>
      _api.sendFriendRequest(recipientId);

  /// Accept a pending request addressed to the caller.
  Future<Friendship> acceptRequest(String friendshipId) =>
      _api.acceptFriendRequest(friendshipId);

  /// Remove an accepted friendship OR decline a pending request (same route).
  Future<void> removeFriendship(String friendshipId) =>
      _api.removeFriendship(friendshipId);

  /// Block a user (also removes any friendship server-side).
  Future<void> block(String userId) => _api.block(userId);
}

/// DI: the friends repository, built on the shared [apiClientProvider].
final friendsRepositoryProvider = Provider<FriendsRepository>((ref) {
  return FriendsRepository(ref.watch(apiClientProvider));
});
