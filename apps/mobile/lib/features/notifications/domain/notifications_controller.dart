import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../../../core/socket/socket.dart';
import '../data/notifications_repository.dart';

/// Immutable view-state for the notifications center: the loaded records,
/// cursor-pagination bookkeeping, a non-blocking "loading more" flag and the
/// authoritative unread count (seeded from the dedicated endpoint, then kept in
/// sync as items arrive / are marked read).
@immutable
class NotificationsState {
  const NotificationsState({
    this.items = const [],
    this.nextCursor,
    this.hasMore = false,
    this.isLoadingMore = false,
    this.unread = 0,
  });

  final List<NotificationItem> items;
  final String? nextCursor;
  final bool hasMore;
  final bool isLoadingMore;

  /// Authoritative unread count (may exceed the count derivable from [items]
  /// when there are unread records beyond the loaded page).
  final int unread;

  NotificationsState copyWith({
    List<NotificationItem>? items,
    String? nextCursor,
    bool? hasMore,
    bool? isLoadingMore,
    int? unread,
    bool clearCursor = false,
  }) =>
      NotificationsState(
        items: items ?? this.items,
        nextCursor: clearCursor ? null : (nextCursor ?? this.nextCursor),
        hasMore: hasMore ?? this.hasMore,
        isLoadingMore: isLoadingMore ?? this.isLoadingMore,
        unread: unread ?? this.unread,
      );
}

/// Owns the notifications center and folds realtime deliveries into it.
///
/// * Initial build loads the first page (`GET /notifications`) + the unread
///   count, then subscribes the socket to `notif:new`; each delivery is
///   prepended (de-duped by id) and bumps the unread count.
/// * [loadMore] appends subsequent cursor pages.
/// * [refresh] re-fetches from scratch.
/// * [markRead] / [markAllRead] optimistically flip `read` + adjust the unread
///   count, reconciling with the server (and rolling back on failure).
class NotificationsController extends AsyncNotifier<NotificationsState> {
  NotificationsRepository get _repo => ref.read(notificationsRepositoryProvider);
  SocketService get _socket => ref.read(socketServiceProvider);

  static const int _pageSize = 20;

  @override
  Future<NotificationsState> build() async {
    final disposer = _socket.onNotification(_onRealtime);
    ref.onDispose(disposer);

    final page = await _repo.list(limit: _pageSize);
    // The unread count is best-effort: fall back to the derivable count if the
    // dedicated endpoint is unavailable so the badge still works.
    int unread;
    try {
      unread = await _repo.unreadCount();
    } catch (_) {
      unread = page.items.where((n) => !n.read).length;
    }
    return NotificationsState(
      items: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      unread: unread,
    );
  }

  /// Prepend a freshly-pushed notification (unread), de-duping by id.
  void _onRealtime(AppNotification n) {
    final current = state.value;
    if (current == null) return;
    if (current.items.any((e) => e.id == n.id)) return;
    state = AsyncData(current.copyWith(
      items: [NotificationItem.fromRealtime(n), ...current.items],
      unread: current.unread + 1,
    ));
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
      final page = await _repo.list(cursor: current.nextCursor, limit: _pageSize);
      // Guard against ids already present from a realtime prepend.
      final existingIds = {for (final e in current.items) e.id};
      final added =
          page.items.where((e) => !existingIds.contains(e.id)).toList();
      state = AsyncData(current.copyWith(
        items: [...current.items, ...added],
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        isLoadingMore: false,
      ));
    } catch (_) {
      final latest = state.value ?? current;
      state = AsyncData(latest.copyWith(isLoadingMore: false));
    }
  }

  /// Pull-to-refresh: reload the first page (and unread count) from scratch.
  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(build);
  }

  /// Optimistically mark one notification read; reconcile with the server.
  Future<void> markRead(String id) async {
    final current = state.value;
    if (current == null) return;
    // Skip unknown ids and already-read items (no count change either way).
    final isUnread = current.items.any((e) => e.id == id && !e.read);
    if (!isUnread) return;

    final previous = current;
    state = AsyncData(current.copyWith(
      items: [
        for (final e in current.items) e.id == id ? e.copyWith(read: true) : e,
      ],
      unread: (current.unread - 1).clamp(0, 1 << 30),
    ));
    try {
      await _repo.markRead(id);
    } catch (_) {
      state = AsyncData(previous); // roll back
    }
  }

  /// Optimistically mark every notification read; reconcile with the server.
  Future<void> markAllRead() async {
    final current = state.value;
    if (current == null || current.unread == 0) return;
    final previous = current;
    state = AsyncData(current.copyWith(
      items: [for (final e in current.items) e.copyWith(read: true)],
      unread: 0,
    ));
    try {
      await _repo.markAllRead();
    } catch (_) {
      state = AsyncData(previous); // roll back
    }
  }
}

/// The notifications center provider (async, realtime-folded).
final notificationsControllerProvider =
    AsyncNotifierProvider<NotificationsController, NotificationsState>(
        NotificationsController.new);

/// Convenience: the unread count for the app-bar bell badge. Reads the loaded
/// state when present; otherwise `0`.
final notificationsUnreadProvider = Provider<int>((ref) {
  return ref.watch(notificationsControllerProvider).value?.unread ?? 0;
});
