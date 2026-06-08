/// Mirrors `packages/shared-types/src/socket.ts` — the realtime event registry
/// and payload shapes for matchmaking, WebRTC signaling, presence, chat, direct
/// calls and notifications.
library;

import 'enums.dart';
import 'matchmaking_models.dart';

/// The `SocketEvents` name registry. Use these constants verbatim with
/// [AppSocket.emit] / [AppSocket.on] so event names never drift from the API.
abstract final class SocketEvents {
  // matchmaking (client→server)
  static const String mmJoin = 'mm:join';
  static const String mmLeave = 'mm:leave';
  static const String mmNext = 'mm:next';
  // matchmaking (server→client)
  static const String mmWaiting = 'mm:waiting';
  static const String mmMatched = 'mm:matched';

  // signaling (WebRTC, bidirectional)
  static const String rtcOffer = 'rtc:offer';
  static const String rtcAnswer = 'rtc:answer';
  static const String rtcIce = 'rtc:ice-candidate';
  static const String rtcHangup = 'rtc:hangup';

  // presence
  static const String presenceOnline = 'presence:online';
  static const String presenceOffline = 'presence:offline';
  static const String presenceSubscribe = 'presence:subscribe';

  // chat
  static const String chatMessage = 'chat:message';
  static const String chatTyping = 'chat:typing';
  static const String chatRead = 'chat:read';

  // direct calls (friends)
  static const String callInvite = 'call:invite';
  static const String callAccept = 'call:accept';
  static const String callDecline = 'call:decline';
  static const String callEnd = 'call:end';

  // notifications
  static const String notifNew = 'notif:new';

  // moderation (server→client): a forced action on the current call session.
  static const String modAction = 'mod:action';

  // errors
  static const String wsError = 'ws:error';
}

/// `mmJoinPayloadSchema` — `{ type, filters }`.
class MmJoinPayload {
  const MmJoinPayload({required this.type, required this.filters});

  final MatchType type;
  final MatchFilters filters;

  Map<String, dynamic> toJson() => {
        'type': type.wire,
        'filters': filters.toJson(),
      };
}

/// `mmMatchedPayloadSchema` — server announces a match.
class MmMatchedPayload {
  const MmMatchedPayload({
    required this.roomId,
    required this.type,
    required this.peer,
    required this.isInitiator,
  });

  final String roomId;
  final MatchType type;
  final PeerInfo peer;

  /// The peer who must create the SDP offer first.
  final bool isInitiator;

  factory MmMatchedPayload.fromJson(Map<String, dynamic> json) => MmMatchedPayload(
        roomId: json['roomId'] as String,
        type: MatchType.fromWire(json['type'] as String?),
        peer: PeerInfo.fromJson(json['peer'] as Map<String, dynamic>),
        isInitiator: json['isInitiator'] as bool? ?? false,
      );
}

/// `mmWaitingPayloadSchema` — `{ positionHint? }`.
class MmWaitingPayload {
  const MmWaitingPayload({this.positionHint});

  final int? positionHint;

  factory MmWaitingPayload.fromJson(Map<String, dynamic> json) =>
      MmWaitingPayload(positionHint: (json['positionHint'] as num?)?.toInt());
}

/// `rtcOfferPayloadSchema` / `rtcAnswerPayloadSchema` — `{ roomId, sdp }`.
class RtcSdpPayload {
  const RtcSdpPayload({required this.roomId, required this.sdp});

  final String roomId;
  final String sdp;

  factory RtcSdpPayload.fromJson(Map<String, dynamic> json) => RtcSdpPayload(
        roomId: json['roomId'] as String,
        sdp: json['sdp'] as String? ?? '',
      );

  Map<String, dynamic> toJson() => {'roomId': roomId, 'sdp': sdp};
}

/// `rtcIcePayloadSchema` — `{ roomId, candidate }`. The candidate is opaque
/// JSON (`RTCIceCandidateInit`) carried through untyped.
class RtcIcePayload {
  const RtcIcePayload({required this.roomId, required this.candidate});

  final String roomId;
  final dynamic candidate;

  factory RtcIcePayload.fromJson(Map<String, dynamic> json) => RtcIcePayload(
        roomId: json['roomId'] as String,
        candidate: json['candidate'],
      );

  Map<String, dynamic> toJson() => {'roomId': roomId, 'candidate': candidate};
}

/// `rtcHangupPayloadSchema` — `{ roomId, reason }`.
class RtcHangupPayload {
  const RtcHangupPayload({required this.roomId, this.reason = MatchEndReason.stop});

  final String roomId;
  final MatchEndReason reason;

  factory RtcHangupPayload.fromJson(Map<String, dynamic> json) => RtcHangupPayload(
        roomId: json['roomId'] as String,
        reason: MatchEndReason.fromWire(json['reason'] as String?),
      );

  Map<String, dynamic> toJson() => {'roomId': roomId, 'reason': reason.wire};
}

/// `presencePayloadSchema` — `{ userId, status }`.
class PresencePayload {
  const PresencePayload({required this.userId, required this.status});

  final String userId;
  final OnlineStatus status;

  factory PresencePayload.fromJson(Map<String, dynamic> json) => PresencePayload(
        userId: json['userId'] as String,
        status: OnlineStatus.fromWire(json['status'] as String?),
      );
}

/// `chatTypingPayloadSchema` — `{ conversationId, isTyping }`.
class ChatTypingPayload {
  const ChatTypingPayload({required this.conversationId, required this.isTyping});

  final String conversationId;
  final bool isTyping;

  factory ChatTypingPayload.fromJson(Map<String, dynamic> json) => ChatTypingPayload(
        conversationId: json['conversationId'] as String,
        isTyping: json['isTyping'] as bool? ?? false,
      );

  Map<String, dynamic> toJson() =>
      {'conversationId': conversationId, 'isTyping': isTyping};
}

/// `chatReadPayloadSchema` — `{ conversationId, messageId }`.
class ChatReadPayload {
  const ChatReadPayload({required this.conversationId, required this.messageId});

  final String conversationId;
  final String messageId;

  factory ChatReadPayload.fromJson(Map<String, dynamic> json) => ChatReadPayload(
        conversationId: json['conversationId'] as String,
        messageId: json['messageId'] as String,
      );

  Map<String, dynamic> toJson() =>
      {'conversationId': conversationId, 'messageId': messageId};
}

/// `callInvitePayloadSchema` (client) — `{ toUserId, type }`. The server adds
/// `callId` + `fromUserId` on the inbound side ([IncomingCall]).
class CallInvitePayload {
  const CallInvitePayload({required this.toUserId, required this.type});

  final String toUserId;
  final MatchType type;

  Map<String, dynamic> toJson() => {'toUserId': toUserId, 'type': type.wire};
}

/// Inbound `call:invite` (server→client): the client payload plus routing ids.
class IncomingCall {
  const IncomingCall({
    required this.callId,
    required this.fromUserId,
    required this.toUserId,
    required this.type,
  });

  final String callId;
  final String fromUserId;
  final String toUserId;
  final MatchType type;

  factory IncomingCall.fromJson(Map<String, dynamic> json) => IncomingCall(
        callId: json['callId'] as String,
        fromUserId: json['fromUserId'] as String? ?? '',
        toUserId: json['toUserId'] as String? ?? '',
        type: MatchType.fromWire(json['type'] as String?),
      );
}

/// `callResponsePayloadSchema` — `{ callId }` (accept/decline/end).
class CallResponsePayload {
  const CallResponsePayload({required this.callId});

  final String callId;

  factory CallResponsePayload.fromJson(Map<String, dynamic> json) =>
      CallResponsePayload(callId: json['callId'] as String);

  Map<String, dynamic> toJson() => {'callId': callId};
}

/// `appNotificationSchema` — a realtime toast/notification.
class AppNotification {
  const AppNotification({
    required this.id,
    required this.kind,
    required this.title,
    required this.body,
    required this.createdAt,
  });

  final String id;
  final NotificationKind kind;
  final String title;
  final String body;
  final DateTime createdAt;

  factory AppNotification.fromJson(Map<String, dynamic> json) => AppNotification(
        id: json['id'] as String,
        kind: NotificationKind.fromWire(json['kind'] as String?),
        title: json['title'] as String? ?? '',
        body: json['body'] as String? ?? '',
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now(),
      );
}

/// `wsErrorPayloadSchema` — a rejected realtime action.
class WsErrorPayload {
  const WsErrorPayload({required this.code, this.event, this.message});

  final WsErrorCode code;
  final String? event;
  final String? message;

  factory WsErrorPayload.fromJson(Map<String, dynamic> json) => WsErrorPayload(
        code: WsErrorCode.fromWire(json['code'] as String?),
        event: json['event'] as String?,
        message: json['message'] as String?,
      );
}
