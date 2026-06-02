/// Mirrors `packages/shared-types/src/notifications.ts` — the STORED
/// notification record (the in-app notifications center) plus the push
/// registration DTOs.
///
/// Distinct from [AppNotification] in `socket_models.dart`: that is the
/// lightweight realtime event delivered on `notif:new`; this is the persisted
/// record returned by `GET /notifications` (it additionally carries `read`,
/// `actorId` and a deep-`link`). Named [NotificationItem] to avoid clashing
/// with Flutter's own `Notification` widget class.
library;

import 'enums.dart';
import 'socket_models.dart' show AppNotification;

/// `notificationSchema` — a stored notification record.
class NotificationItem {
  const NotificationItem({
    required this.id,
    required this.kind,
    required this.title,
    required this.body,
    required this.read,
    this.actorId,
    this.link,
    required this.createdAt,
  });

  final String id;
  final NotificationKind kind;
  final String title;
  final String body;

  /// Whether the recipient has seen it.
  final bool read;

  /// The user who triggered it (gift/message/request sender), if any.
  final String? actorId;

  /// Optional in-app deep link (e.g. `/chat/<id>`, `/profile/<id>`).
  final String? link;

  final DateTime createdAt;

  factory NotificationItem.fromJson(Map<String, dynamic> json) => NotificationItem(
        id: json['id'] as String,
        kind: NotificationKind.fromWire(json['kind'] as String?),
        title: json['title'] as String? ?? '',
        body: json['body'] as String? ?? '',
        read: json['read'] as bool? ?? false,
        actorId: json['actorId'] as String?,
        link: json['link'] as String?,
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
      );

  /// Build a stored record from a realtime [AppNotification] (a freshly-pushed
  /// item is unread and carries no persisted actor/link yet).
  factory NotificationItem.fromRealtime(AppNotification n) => NotificationItem(
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        read: false,
        createdAt: n.createdAt,
      );

  NotificationItem copyWith({bool? read}) => NotificationItem(
        id: id,
        kind: kind,
        title: title,
        body: body,
        read: read ?? this.read,
        actorId: actorId,
        link: link,
        createdAt: createdAt,
      );
}

/// `unreadCountSchema` — `{ count }` for the header badge.
class UnreadCount {
  const UnreadCount({required this.count});

  final int count;

  factory UnreadCount.fromJson(Map<String, dynamic> json) =>
      UnreadCount(count: (json['count'] as num?)?.toInt() ?? 0);
}

/// `devicePushTokenSchema` — register a mobile push token (FCM/APNs) for the
/// calling device via `POST /notifications/push/device-token`.
class DevicePushTokenDto {
  const DevicePushTokenDto({required this.token, required this.platform});

  final String token;

  /// `'android' | 'ios' | 'web'`.
  final String platform;

  Map<String, dynamic> toJson() => {'token': token, 'platform': platform};
}
