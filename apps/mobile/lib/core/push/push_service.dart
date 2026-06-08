import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';

/// A push message as the app consumes it, decoupled from the FCM SDK types so
/// the rest of the app (and the no-op) never imports `firebase_*`.
///
/// [link] is the canonical in-app deep link (e.g. `/chats/:id`) the backend puts
/// in the FCM `data` map; a notification tap routes to it. [title]/[body] render
/// the foreground in-app banner (FCM does not show a tray notification while the
/// app is foregrounded, so we surface it ourselves).
@immutable
class PushMessage {
  const PushMessage({this.title, this.body, this.link, this.kind});

  final String? title;
  final String? body;
  final String? link;
  final String? kind;

  /// Build from a raw FCM `data` map + optional notification title/body.
  factory PushMessage.fromData(
    Map<String, dynamic> data, {
    String? title,
    String? body,
  }) {
    return PushMessage(
      title: title,
      body: body,
      link: data['link'] as String?,
      kind: data['kind'] as String?,
    );
  }
}

/// Callbacks the [PushService] invokes for incoming messages. Both are optional
/// and safe to omit (the no-op never calls them).
@immutable
class PushMessageHandlers {
  const PushMessageHandlers({this.onForeground, this.onTap});

  /// A message arrived while the app is in the foreground — show it in-app.
  final void Function(PushMessage message)? onForeground;

  /// The user TAPPED a (background/terminated) notification — deep-link to it.
  final void Function(PushMessage message)? onTap;
}

/// Abstraction over the platform push provider (FCM on Android, APNs-via-FCM on
/// iOS). Kept behind this small interface so the rest of the app never imports
/// `firebase_*` directly and the dev build runs with a WORKING keyless default
/// (see [NoopPushService]) when Firebase isn't configured.
///
/// Lifecycle:
///  * [start] is called once the user is authenticated. It (best-effort)
///    requests notification permission, obtains the device token and hands each
///    token — current and future refreshes — to [onToken] for registration with
///    the backend (`POST /notifications/push/device-token`). Incoming messages
///    are routed to the optional [handlers].
///  * [stop] is called on logout to release listeners (and let the caller
///    unregister the last token).
///
/// Implementations MUST NOT throw out of [start]/[stop]; a misconfigured or
/// unavailable provider degrades to "no push" rather than crashing app boot.
abstract interface class PushService {
  /// Whether this implementation can actually deliver push (i.e. a real
  /// provider is wired and configured). The no-op returns `false`.
  bool get isAvailable;

  /// Begin token acquisition. [onToken] is invoked with the current FCM/APNs
  /// token (if any) and again on every refresh. [platform] is the wire value
  /// for [DevicePushTokenDto.platform] (`'android' | 'ios'`). [handlers] route
  /// foreground messages + notification taps (deep-link).
  Future<void> start(
    void Function(String token, String platform) onToken, {
    PushMessageHandlers handlers,
  });

  /// The most recently observed device token, if one has been obtained.
  String? get currentToken;

  /// Release any listeners/streams. Safe to call when never started.
  Future<void> stop();
}

/// The default, keyless implementation: does nothing and reports unavailable.
///
/// This is what the app boots with so it runs WITHOUT a Firebase project or
/// `google-services.json` / `GoogleService-Info.plist`. Real push is enabled by
/// initializing Firebase at boot (guarded) and overriding [pushServiceProvider]
/// with `FirebasePushService` (see `firebase_push_service.dart` + `main.dart`).
class NoopPushService implements PushService {
  const NoopPushService();

  @override
  bool get isAvailable => false;

  @override
  String? get currentToken => null;

  @override
  Future<void> start(
    void Function(String token, String platform) onToken, {
    PushMessageHandlers handlers = const PushMessageHandlers(),
  }) async {
    if (kDebugMode) {
      debugPrint('[push] NoopPushService active — push disabled '
          '(no Firebase config). See core/push/firebase_push_service.dart.');
    }
  }

  @override
  Future<void> stop() async {}
}

/// The wire `platform` value for the current OS, or `null` on platforms we
/// don't register a native push token for (web/desktop).
String? currentPushPlatform() {
  if (kIsWeb) return 'web';
  if (Platform.isAndroid) return 'android';
  if (Platform.isIOS) return 'ios';
  return null;
}
