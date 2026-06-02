/// Mirrors `packages/shared-types/src/social.ts`.
library;

import 'enums.dart';

/// `friendshipSchema` — a friendship/request edge between two users.
class Friendship {
  const Friendship({
    required this.id,
    required this.requesterId,
    required this.recipientId,
    required this.status,
    required this.createdAt,
  });

  final String id;
  final String requesterId;
  final String recipientId;
  final FriendshipStatus status;
  final DateTime createdAt;

  factory Friendship.fromJson(Map<String, dynamic> json) => Friendship(
        id: json['id'] as String,
        requesterId: json['requesterId'] as String? ?? '',
        recipientId: json['recipientId'] as String? ?? '',
        status: FriendshipStatus.fromWire(json['status'] as String?),
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
      );
}

/// The minimal profile slice embedded in a [FriendSummary]
/// (`friendSummarySchema.profile` — id/nickname/avatarUrl/isPremium/badges).
class FriendProfile {
  const FriendProfile({
    required this.id,
    required this.nickname,
    required this.avatarUrl,
    required this.isPremium,
    required this.badges,
  });

  final String id;
  final String nickname;
  final String? avatarUrl;
  final bool isPremium;
  final List<Badge> badges;

  factory FriendProfile.fromJson(Map<String, dynamic> json) => FriendProfile(
        id: json['id'] as String,
        nickname: json['nickname'] as String? ?? '',
        avatarUrl: json['avatarUrl'] as String?,
        isPremium: json['isPremium'] as bool? ?? false,
        badges: Badge.listFromWire(json['badges']),
      );
}

/// `friendSummarySchema` — a friend row with presence.
class FriendSummary {
  const FriendSummary({
    required this.friendshipId,
    required this.profile,
    required this.status,
    required this.since,
  });

  final String friendshipId;
  final FriendProfile profile;
  final OnlineStatus status;
  final DateTime since;

  factory FriendSummary.fromJson(Map<String, dynamic> json) => FriendSummary(
        friendshipId: json['friendshipId'] as String,
        profile: FriendProfile.fromJson(json['profile'] as Map<String, dynamic>),
        status: OnlineStatus.fromWire(json['status'] as String?),
        since: DateTime.tryParse(json['since'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
      );
}

/// The direction of a pending [FriendRequestItem] relative to the caller.
/// `incoming` = they asked you; `outgoing` = you asked them (awaiting accept).
enum FriendRequestDirection {
  incoming,
  outgoing;

  static FriendRequestDirection fromWire(String? wire) =>
      wire == 'outgoing' ? FriendRequestDirection.outgoing : FriendRequestDirection.incoming;
}

/// `friendRequestItemSchema` — a single pending friend request (either
/// direction) from `GET /friends/requests`. Carries the counterpart's minimal
/// profile (same slice as [FriendProfile]) so the UI can show an avatar + name.
class FriendRequestItem {
  const FriendRequestItem({
    required this.friendshipId,
    required this.profile,
    required this.direction,
    required this.createdAt,
  });

  final String friendshipId;
  final FriendProfile profile;
  final FriendRequestDirection direction;
  final DateTime createdAt;

  factory FriendRequestItem.fromJson(Map<String, dynamic> json) => FriendRequestItem(
        friendshipId: json['friendshipId'] as String,
        profile: FriendProfile.fromJson(json['profile'] as Map<String, dynamic>),
        direction: FriendRequestDirection.fromWire(json['direction'] as String?),
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
      );
}

/// `friendRequestsResponseSchema` — both directions of pending requests in one
/// response (`GET /friends/requests`).
class FriendRequestsResponse {
  const FriendRequestsResponse({
    required this.incoming,
    required this.outgoing,
  });

  final List<FriendRequestItem> incoming;
  final List<FriendRequestItem> outgoing;

  factory FriendRequestsResponse.fromJson(Map<String, dynamic> json) => FriendRequestsResponse(
        incoming: ((json['incoming'] as List?) ?? const [])
            .map((e) => FriendRequestItem.fromJson(e as Map<String, dynamic>))
            .toList(growable: false),
        outgoing: ((json['outgoing'] as List?) ?? const [])
            .map((e) => FriendRequestItem.fromJson(e as Map<String, dynamic>))
            .toList(growable: false),
      );

  static const empty = FriendRequestsResponse(incoming: [], outgoing: []);
}

/// `messageSchema` — one direct message.
class Message {
  const Message({
    required this.id,
    required this.conversationId,
    required this.senderId,
    required this.type,
    required this.content,
    required this.readAt,
    required this.createdAt,
  });

  final String id;
  final String conversationId;
  final String senderId;
  final MessageType type;
  final String content;
  final DateTime? readAt;
  final DateTime createdAt;

  factory Message.fromJson(Map<String, dynamic> json) => Message(
        id: json['id'] as String,
        conversationId: json['conversationId'] as String? ?? '',
        senderId: json['senderId'] as String? ?? '',
        type: MessageType.fromWire(json['type'] as String?),
        content: json['content'] as String? ?? '',
        readAt: json['readAt'] != null ? DateTime.tryParse(json['readAt'] as String) : null,
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'conversationId': conversationId,
        'senderId': senderId,
        'type': type.wire,
        'content': content,
        'readAt': readAt?.toIso8601String(),
        'createdAt': createdAt.toIso8601String(),
      };
}

/// `conversationSchema` — a 2-party conversation with unread count.
class Conversation {
  const Conversation({
    required this.id,
    required this.participants,
    required this.lastMessageAt,
    required this.lastMessagePreview,
    required this.unreadCount,
  });

  final String id;
  final List<String> participants;
  final DateTime? lastMessageAt;
  final String? lastMessagePreview;
  final int unreadCount;

  factory Conversation.fromJson(Map<String, dynamic> json) => Conversation(
        id: json['id'] as String,
        participants: ((json['participants'] as List?) ?? const [])
            .map((e) => e as String)
            .toList(growable: false),
        lastMessageAt: json['lastMessageAt'] != null
            ? DateTime.tryParse(json['lastMessageAt'] as String)
            : null,
        lastMessagePreview: json['lastMessagePreview'] as String?,
        unreadCount: (json['unreadCount'] as num?)?.toInt() ?? 0,
      );

  /// The other participant's id, given the current user's [selfId].
  String? peerId(String selfId) {
    for (final p in participants) {
      if (p != selfId) return p;
    }
    return participants.isNotEmpty ? participants.first : null;
  }
}

/// `sendMessageSchema` — exactly one of [conversationId] / [recipientId] is set.
class SendMessageDto {
  const SendMessageDto({
    this.conversationId,
    this.recipientId,
    this.type = MessageType.text,
    required this.content,
  }) : assert(conversationId != null || recipientId != null,
            'conversationId or recipientId is required');

  final String? conversationId;
  final String? recipientId;
  final MessageType type;
  final String content;

  Map<String, dynamic> toJson() => {
        if (conversationId != null) 'conversationId': conversationId,
        if (recipientId != null) 'recipientId': recipientId,
        'type': type.wire,
        'content': content,
      };
}
