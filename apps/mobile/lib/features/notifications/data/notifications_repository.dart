import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/di/di.dart';
import '../../../core/models/models.dart';

/// Thin data layer over the foundation's [ApiClient] for the notifications
/// domain, sourced from the REST contract (`@ruletka/shared-types` + the NestJS
/// `/notifications` controller):
///
///   GET    /notifications                       → `Paginated<NotificationItem>`
///   GET    /notifications/unread-count          → `{ count }`
///   POST   /notifications/:id/read              → 204 (mark one read)
///   POST   /notifications/read-all              → 204 (mark all read)
///
/// (Push device-token registration is driven from `core/push` against the
/// shared [ApiClient] directly, so it isn't surfaced here.)
///
/// The domain/presentation layers depend on this so the API surface stays in
/// one place and is trivially fakeable in tests.
class NotificationsRepository {
  NotificationsRepository(this._api);

  final ApiClient _api;

  /// A page of the caller's stored notifications (newest first).
  Future<Paginated<NotificationItem>> list({
    String? cursor,
    int? limit,
    bool? unreadOnly,
  }) =>
      _api.notifications(cursor: cursor, limit: limit, unreadOnly: unreadOnly);

  /// The current unread count (for the header badge).
  Future<int> unreadCount() async => (await _api.notificationsUnreadCount()).count;

  /// Mark a single notification as read.
  Future<void> markRead(String id) => _api.markNotificationRead(id);

  /// Mark every notification as read.
  Future<void> markAllRead() => _api.markAllNotificationsRead();
}

/// DI: the notifications repository, built on the shared [apiClientProvider].
final notificationsRepositoryProvider = Provider<NotificationsRepository>((ref) {
  return NotificationsRepository(ref.watch(apiClientProvider));
});
