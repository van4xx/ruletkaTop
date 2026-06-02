import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../../../core/socket/socket.dart';
import '../data/chat_repository.dart';

/// Immutable conversation-inbox state: the loaded conversations (kept sorted
/// most-recently-active first) plus cursor-pagination bookkeeping.
@immutable
class ConversationsState {
  const ConversationsState({
    this.conversations = const [],
    this.nextCursor,
    this.hasMore = false,
    this.isLoadingMore = false,
  });

  final List<Conversation> conversations;
  final String? nextCursor;
  final bool hasMore;
  final bool isLoadingMore;

  /// Total unread messages across all conversations (for a tab badge).
  int get totalUnread =>
      conversations.fold(0, (sum, c) => sum + c.unreadCount);

  ConversationsState copyWith({
    List<Conversation>? conversations,
    String? nextCursor,
    bool? hasMore,
    bool? isLoadingMore,
  }) =>
      ConversationsState(
        conversations: conversations ?? this.conversations,
        nextCursor: nextCursor ?? this.nextCursor,
        hasMore: hasMore ?? this.hasMore,
        isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      );
}

/// Owns the conversation inbox and keeps it live.
///
/// * Initial build loads the first page (`GET /conversations`).
/// * Every incoming `chat:message` patches the matching conversation (preview,
///   `lastMessageAt`, unread bump) and moves it to the top — no refetch. A
///   message for an unknown conversation triggers a single refresh.
/// * The currently-open thread id ([setActiveConversation]) is suppressed from
///   unread inflation so the badge doesn't grow while you're reading it.
/// * `chat:read` for a conversation zeroes its unread count.
class ConversationsController extends AsyncNotifier<ConversationsState> {
  ChatRepository get _repo => ref.read(chatRepositoryProvider);
  SocketService get _socket => ref.read(socketServiceProvider);

  static const int _pageSize = 30;

  /// The thread the user is currently viewing (unread suppressed for it).
  String? _activeConversationId;

  @override
  Future<ConversationsState> build() async {
    final disposers = <VoidCallback>[
      _socket.onChatMessage(_onIncomingMessage),
      _socket.onChatRead(_onRead),
    ];
    ref.onDispose(() {
      for (final d in disposers) {
        d();
      }
    });

    final page = await _repo.listConversations(limit: _pageSize);
    return ConversationsState(
      conversations: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    );
  }

  /// Mark which thread is open so its unread badge isn't inflated live.
  void setActiveConversation(String? id) => _activeConversationId = id;

  void _onIncomingMessage(Message m) {
    final current = state.value;
    if (current == null) return;
    final idx =
        current.conversations.indexWhere((c) => c.id == m.conversationId);
    if (idx == -1) {
      // First contact / unknown conversation: refetch the inbox once.
      refresh();
      return;
    }
    final existing = current.conversations[idx];
    final isActive = m.conversationId == _activeConversationId;
    final updated = Conversation(
      id: existing.id,
      participants: existing.participants,
      lastMessageAt: m.createdAt,
      lastMessagePreview: m.content,
      unreadCount: isActive ? 0 : existing.unreadCount + 1,
    );
    final next = [...current.conversations]..removeAt(idx);
    next.insert(0, updated);
    state = AsyncData(current.copyWith(conversations: next));
  }

  void _onRead(ChatReadPayload p) => zeroUnread(p.conversationId);

  /// Zero the unread badge for a conversation (called when its thread is read).
  void zeroUnread(String conversationId) {
    final current = state.value;
    if (current == null) return;
    var changed = false;
    final next = [
      for (final c in current.conversations)
        if (c.id == conversationId && c.unreadCount != 0)
          () {
            changed = true;
            return Conversation(
              id: c.id,
              participants: c.participants,
              lastMessageAt: c.lastMessageAt,
              lastMessagePreview: c.lastMessagePreview,
              unreadCount: 0,
            );
          }()
        else
          c,
    ];
    if (changed) state = AsyncData(current.copyWith(conversations: next));
  }

  /// Fetch and append the next cursor page.
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
      final page = await _repo.listConversations(
          cursor: current.nextCursor, limit: _pageSize);
      state = AsyncData(current.copyWith(
        conversations: [...current.conversations, ...page.items],
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        isLoadingMore: false,
      ));
    } catch (_) {
      final latest = state.value ?? current;
      state = AsyncData(latest.copyWith(isLoadingMore: false));
    }
  }

  /// Pull-to-refresh: reload the first page.
  Future<void> refresh() async {
    final page = await _repo.listConversations(limit: _pageSize);
    state = AsyncData(ConversationsState(
      conversations: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    ));
  }

  /// Find an existing conversation with [peerUserId] in the loaded inbox, if
  /// any (used by the friends "message" quick action to jump straight to the
  /// thread instead of opening a fresh compose view).
  Conversation? conversationWithPeer(String peerUserId) {
    final current = state.value;
    if (current == null) return null;
    for (final c in current.conversations) {
      if (c.participants.contains(peerUserId)) return c;
    }
    return null;
  }
}

/// The conversation inbox provider (async, kept live by the socket).
final conversationsControllerProvider =
    AsyncNotifierProvider<ConversationsController, ConversationsState>(
        ConversationsController.new);

/// Convenience: total unread count across conversations (for a tab badge).
final unreadConversationsCountProvider = Provider<int>((ref) {
  return ref.watch(conversationsControllerProvider).maybeWhen(
        data: (s) => s.totalUnread,
        orElse: () => 0,
      );
});
