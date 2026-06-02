import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/di/di.dart';
import '../../../core/models/models.dart';

/// Data layer over the foundation's [ApiClient] for the chat domain, sourced
/// from the REST contract + the NestJS chat controllers (`/api`):
///
///   GET  /conversations                 → `Paginated<Conversation>` (recent first)
///   GET  /conversations/:id/messages     → `Paginated<Message>`      (newest first)
///   POST /messages                       → Message (creates the conv. if needed)
///   GET  /profiles/:id                   → PublicProfile (peer header/rows)
///
/// Realtime sends go through the socket ([SocketService.chatMessage]); the REST
/// [sendMessage] here is the offline fallback the thread engine uses when the
/// socket isn't connected.
class ChatRepository {
  ChatRepository(this._api);

  final ApiClient _api;

  /// A page of the caller's conversations (most-recently-active first).
  Future<Paginated<Conversation>> listConversations({
    String? cursor,
    int? limit,
  }) =>
      _api.conversations(cursor: cursor, limit: limit);

  /// A page of messages for [conversationId] (newest first).
  Future<Paginated<Message>> listMessages(
    String conversationId, {
    String? cursor,
    int? limit,
  }) =>
      _api.messages(conversationId, cursor: cursor, limit: limit);

  /// Persist a message over REST (used as a fallback when the socket is down,
  /// and to create a conversation from a recipient id on first contact).
  Future<Message> sendMessage(SendMessageDto dto) => _api.sendMessage(dto);

  /// Resolve a peer's public profile (cached by the provider below).
  Future<PublicProfile> peerProfile(String userId, {CancelToken? cancelToken}) =>
      _api.profileById(userId, cancelToken: cancelToken);
}

/// DI: the chat repository, built on the shared [apiClientProvider].
final chatRepositoryProvider = Provider<ChatRepository>((ref) {
  return ChatRepository(ref.watch(apiClientProvider));
});

/// A peer's public profile, cached per user id and reused by the inbox rows and
/// the thread header. Auto-disposes when no longer watched.
final peerProfileProvider =
    FutureProvider.family<PublicProfile, String>((ref, userId) async {
  final cancel = CancelToken();
  ref.onDispose(cancel.cancel);
  return ref.watch(chatRepositoryProvider).peerProfile(userId, cancelToken: cancel);
});
