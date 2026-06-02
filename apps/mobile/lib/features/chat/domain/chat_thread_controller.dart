import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../../../core/socket/socket.dart';
import '../data/chat_repository.dart';
import 'conversations_controller.dart';

/// A [Message] augmented with client-side delivery state for optimistic UI.
@immutable
class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.conversationId,
    required this.senderId,
    required this.type,
    required this.content,
    required this.readAt,
    required this.createdAt,
    this.pending = false,
    this.failed = false,
    this.clientId,
  });

  final String id;
  final String conversationId;
  final String senderId;
  final MessageType type;
  final String content;
  final DateTime? readAt;
  final DateTime createdAt;

  /// Local-only: awaiting server confirmation.
  final bool pending;

  /// Local-only: the optimistic send failed (offer a retry).
  final bool failed;

  /// Local correlation id for optimistic bubbles (before the real id lands).
  final String? clientId;

  factory ChatMessage.fromMessage(Message m) => ChatMessage(
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        type: m.type,
        content: m.content,
        readAt: m.readAt,
        createdAt: m.createdAt,
      );

  ChatMessage copyWith({
    String? id,
    String? conversationId,
    DateTime? readAt,
    bool? pending,
    bool? failed,
  }) =>
      ChatMessage(
        id: id ?? this.id,
        conversationId: conversationId ?? this.conversationId,
        senderId: senderId,
        type: type,
        content: content,
        readAt: readAt ?? this.readAt,
        createdAt: createdAt,
        pending: pending ?? this.pending,
        failed: failed ?? this.failed,
        clientId: clientId,
      );
}

/// A parsed thread argument: either an existing conversation, or a compose
/// target (a peer user id) for a not-yet-created conversation.
@immutable
class ThreadArg {
  const ThreadArg.conversation(this.conversationId) : recipientId = null;
  const ThreadArg.compose(this.recipientId) : conversationId = null;

  final String? conversationId;
  final String? recipientId;

  bool get isCompose => conversationId == null;

  /// Parse the `/chat/:id` path param (+ optional `?to=` for compose):
  ///   • `c:<id>` or a bare id  → existing conversation
  ///   • `new` / `u:<userId>` / `?to=<userId>` → compose with that recipient
  factory ThreadArg.parse(String idParam, {String? toQuery}) {
    if (toQuery != null && toQuery.isNotEmpty) return ThreadArg.compose(toQuery);
    if (idParam.startsWith('u:')) return ThreadArg.compose(idParam.substring(2));
    if (idParam == 'new') return const ThreadArg.compose('');
    if (idParam.startsWith('c:')) {
      return ThreadArg.conversation(idParam.substring(2));
    }
    return ThreadArg.conversation(idParam);
  }

  @override
  bool operator ==(Object other) =>
      other is ThreadArg &&
      other.conversationId == conversationId &&
      other.recipientId == recipientId;

  @override
  int get hashCode => Object.hash(conversationId, recipientId);
}

/// The realtime message-thread engine for a single conversation, mirroring the
/// web's `useThread`. Implemented as a [ChangeNotifier] driven by a
/// `Provider.family` (see [chatThreadControllerProvider]) so the family
/// argument and listener disposal are explicit and unambiguous.
///
///  * **History**: cursor pages from `GET /conversations/:id/messages` (newest
///    first), reversed to chronological, merged (de-duped by id) with local
///    optimistic/received messages.
///  * **Send**: an optimistic bubble is appended immediately, then
///    `chat:message` is emitted over the socket; the gateway echoes the
///    persisted [Message] back (via `chat:message`), reconciling the optimistic
///    twin. A short grace window clears the pending flag as a safety net. When
///    the socket is down we persist over `POST /messages` and adopt the result.
///  * **Receive**: incoming `chat:message` for this conversation is appended.
///  * **Typing**: emits `chat:typing` (throttled start, debounced stop) and
///    surfaces the peer's typing state via [peerTyping].
///  * **Receipts**: marks the newest inbound message read (`chat:read`) and
///    reflects the peer reading our messages (sent → read).
///
/// In **compose mode** the first send goes out with `recipientId`; once the
/// server echoes a [Message] we adopt its real `conversationId`.
class ChatThreadController extends ChangeNotifier {
  ChatThreadController(this._ref, this._arg) {
    _conversationId = _arg.conversationId;
    _disposers.addAll([
      _socket.onChatMessage(_onIncoming),
      _socket.onChatTyping(_onTyping),
      _socket.onChatRead(_onPeerRead),
    ]);
    _load();
  }

  final Ref _ref;
  ThreadArg _arg;

  ChatRepository get _repo => _ref.read(chatRepositoryProvider);
  SocketService get _socket => _ref.read(socketServiceProvider);
  String? get _selfId => _ref.read(currentUserIdProvider);

  static const int _pageSize = 30;

  // ── Public, immutable view-state (read by the screen) ──
  List<ChatMessage> _messages = const [];
  List<ChatMessage> get messages => _messages;

  bool _isLoading = true;
  bool get isLoading => _isLoading;

  bool _hasError = false;
  bool get hasError => _hasError;

  bool _isLoadingOlder = false;
  bool get isLoadingOlder => _isLoadingOlder;

  bool get hasMore => _hasMore;

  bool _peerTyping = false;
  bool get peerTyping => _peerTyping;

  /// Resolved real conversation id (null in compose mode until first send).
  String? get conversationId => _conversationId;

  // ── Internals ──
  String? _conversationId;
  final List<ChatMessage> _local = [];
  List<ChatMessage> _history = [];
  String? _nextCursor;
  bool _hasMore = false;

  Timer? _peerTypingTimer;
  Timer? _stopTypingTimer;
  bool _typingActive = false;
  String? _lastReadInboundId;

  final List<VoidCallback> _disposers = [];
  bool _disposed = false;

  Future<void> _load() async {
    if (_arg.isCompose) {
      _isLoading = false;
      _recompute();
      return;
    }
    try {
      final page =
          await _repo.listMessages(_arg.conversationId!, limit: _pageSize);
      _nextCursor = page.nextCursor;
      _hasMore = page.hasMore;
      _history = page.items.reversed.map(ChatMessage.fromMessage).toList();
      _isLoading = false;
      _hasError = false;
      _recompute();
      _markNewestInboundRead();
    } catch (_) {
      _isLoading = false;
      _hasError = true;
      _safeNotify();
    }
  }

  /// Retry the initial history load after an error.
  Future<void> reload() async {
    _isLoading = true;
    _hasError = false;
    _safeNotify();
    await _load();
  }

  @override
  void dispose() {
    _disposed = true;
    for (final d in _disposers) {
      d();
    }
    _peerTypingTimer?.cancel();
    _stopTypingTimer?.cancel();
    if (_typingActive && _conversationId != null) {
      _socket.chatTyping(_conversationId!, false);
      _typingActive = false;
    }
    super.dispose();
  }

  void _safeNotify() {
    if (!_disposed) notifyListeners();
  }

  /// Recompute the merged, chronological, de-duped message list and notify.
  void _recompute() {
    final byId = <String, ChatMessage>{};
    for (final m in _history) {
      byId[m.id] = m;
    }
    for (final m in _local) {
      final existing = byId[m.id];
      byId[m.id] = existing == null
          ? m
          : m.copyWith(readAt: m.readAt ?? existing.readAt);
    }
    final list = byId.values.toList()
      ..sort((a, b) => a.createdAt.compareTo(b.createdAt));
    _messages = List.unmodifiable(list);
    _safeNotify();
  }

  bool _isForThisThread(String conversationId) =>
      _conversationId != null && conversationId == _conversationId;

  // ───────────────────────────── Incoming ───────────────────────────────
  void _onIncoming(Message raw) {
    if (_conversationId == null) {
      // Compose mode: adopt the conversation id only once OUR first message
      // echoes back (matched by a pending optimistic twin on the same content).
      final mine = _selfId != null && raw.senderId == _selfId;
      final hasPendingTwin =
          _local.any((p) => p.pending && p.content == raw.content);
      if (mine && hasPendingTwin) {
        _conversationId = raw.conversationId;
        _arg = ThreadArg.conversation(raw.conversationId);
      } else {
        return;
      }
    } else if (!_isForThisThread(raw.conversationId)) {
      return;
    }

    final incoming = ChatMessage.fromMessage(raw);
    if (_selfId != null && raw.senderId == _selfId) {
      _local.removeWhere((p) => p.pending && p.content == raw.content);
      if (!_local.any((p) => p.id == raw.id)) _local.add(incoming);
    } else {
      if (!_local.any((p) => p.id == raw.id) &&
          !_history.any((p) => p.id == raw.id)) {
        _local.add(incoming);
      }
    }
    _recompute();
    _markNewestInboundRead();
  }

  void _onTyping(ChatTypingPayload p) {
    if (!_isForThisThread(p.conversationId)) return;
    _peerTypingTimer?.cancel();
    if (p.isTyping) {
      _peerTyping = true;
      _peerTypingTimer = Timer(const Duration(seconds: 4), () {
        _peerTyping = false;
        _safeNotify();
      });
    } else {
      _peerTyping = false;
    }
    _safeNotify();
  }

  void _onPeerRead(ChatReadPayload p) {
    if (!_isForThisThread(p.conversationId)) return;
    final now = DateTime.now();
    var changed = false;
    for (var i = 0; i < _local.length; i++) {
      final m = _local[i];
      if (m.senderId == _selfId && m.readAt == null) {
        _local[i] = m.copyWith(readAt: now);
        changed = true;
      }
    }
    _history = [
      for (final m in _history)
        if (m.senderId == _selfId && m.readAt == null)
          () {
            changed = true;
            return m.copyWith(readAt: now);
          }()
        else
          m,
    ];
    if (changed) _recompute();
  }

  /// Emit `chat:read` for the newest inbound, not-yet-read message + zero the
  /// inbox badge for this conversation.
  void _markNewestInboundRead() {
    if (_conversationId == null || _selfId == null) return;
    ChatMessage? lastInbound;
    for (final m in _messages.reversed) {
      if (m.senderId != _selfId && !m.pending) {
        lastInbound = m;
        break;
      }
    }
    if (lastInbound == null) return;
    if (lastInbound.id == _lastReadInboundId || lastInbound.readAt != null) {
      return;
    }
    _lastReadInboundId = lastInbound.id;
    _socket.chatRead(_conversationId!, lastInbound.id);
    _ref
        .read(conversationsControllerProvider.notifier)
        .zeroUnread(_conversationId!);
  }

  // ────────────────────────────── Sending ───────────────────────────────
  /// Send [content] (optimistic). Trims; no-ops on empty.
  void send(String content) {
    final trimmed = content.trim();
    if (trimmed.isEmpty) return;
    final clientId =
        'tmp-${DateTime.now().microsecondsSinceEpoch}-${_local.length}';
    _local.add(ChatMessage(
      id: clientId,
      clientId: clientId,
      conversationId: _conversationId ?? '',
      senderId: _selfId ?? 'me',
      type: MessageType.text,
      content: trimmed,
      readAt: null,
      createdAt: DateTime.now(),
      pending: true,
    ));
    _recompute();
    _cancelTyping();

    void finalize({required bool ok, Message? server}) {
      final idx = _local.indexWhere((m) => m.clientId == clientId);
      if (idx == -1) return;
      if (ok && server != null) {
        if (_conversationId == null) {
          _conversationId = server.conversationId;
          _arg = ThreadArg.conversation(server.conversationId);
        }
        _local[idx] = ChatMessage.fromMessage(server);
      } else if (ok) {
        _local[idx] = _local[idx].copyWith(pending: false);
      } else {
        _local[idx] = _local[idx].copyWith(pending: false, failed: true);
      }
      _recompute();
    }

    if (_socket.isConnected) {
      if (_conversationId != null) {
        _socket.chatMessage(conversationId: _conversationId, content: trimmed);
      } else {
        _socket.chatMessage(recipientId: _arg.recipientId, content: trimmed);
      }
      // Safety net: clear the pending flag if no echo arrives in time.
      Timer(const Duration(seconds: 6), () {
        final idx = _local.indexWhere((m) => m.clientId == clientId);
        if (idx != -1 && _local[idx].pending) {
          _local[idx] = _local[idx].copyWith(pending: false);
          _recompute();
        }
      });
    } else {
      final dto = _conversationId != null
          ? SendMessageDto(conversationId: _conversationId, content: trimmed)
          : SendMessageDto(recipientId: _arg.recipientId, content: trimmed);
      _repo.sendMessage(dto).then(
            (server) => finalize(ok: true, server: server),
            onError: (_) => finalize(ok: false),
          );
    }
  }

  /// Re-send a failed bubble: drop it and send its content again.
  void retry(ChatMessage message) {
    _local.removeWhere((m) => m.clientId == message.clientId);
    _recompute();
    send(message.content);
  }

  /// Load an older page of history (prepended). Returns when done.
  Future<void> loadOlder() async {
    if (_conversationId == null ||
        !_hasMore ||
        _nextCursor == null ||
        _isLoadingOlder) {
      return;
    }
    _isLoadingOlder = true;
    _safeNotify();
    try {
      final page = await _repo.listMessages(_conversationId!,
          cursor: _nextCursor, limit: _pageSize);
      _nextCursor = page.nextCursor;
      _hasMore = page.hasMore;
      final older = page.items.reversed.map(ChatMessage.fromMessage);
      _history = [...older, ..._history];
    } catch (_) {
      // Leave history as-is; user can retry by scrolling again.
    } finally {
      _isLoadingOlder = false;
      _recompute();
    }
  }

  // ────────────────────────────── Typing ────────────────────────────────
  /// Signal that the user is typing (throttled start, debounced stop).
  void notifyTyping() {
    if (_conversationId == null) return; // can't type into an unborn thread
    if (!_typingActive) {
      _typingActive = true;
      _socket.chatTyping(_conversationId!, true);
    }
    _stopTypingTimer?.cancel();
    _stopTypingTimer = Timer(const Duration(milliseconds: 1800), _cancelTyping);
  }

  void _cancelTyping() {
    _stopTypingTimer?.cancel();
    if (_typingActive && _conversationId != null) {
      _socket.chatTyping(_conversationId!, false);
    }
    _typingActive = false;
  }
}

/// The thread engine, one instance per [ThreadArg] (conversation or compose
/// target). `ref.invalidate`/auto-dispose tears down its socket listeners.
final chatThreadControllerProvider =
    Provider.family<ChatThreadController, ThreadArg>((ref, arg) {
  final controller = ChatThreadController(ref, arg);
  ref.onDispose(controller.dispose);
  return controller;
});
