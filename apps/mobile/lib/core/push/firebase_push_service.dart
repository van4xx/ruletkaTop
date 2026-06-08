// ─────────────────────────────────────────────────────────────────────────────
// Firebase Cloud Messaging (FCM on Android, APNs-via-FCM on iOS) implementation
// of [PushService].
//
// The app boots + runs WITHOUT this: `main.dart` attempts `Firebase.initializeApp`
// inside a guard and only overrides [pushServiceProvider] with this service when
// init succeeds. Absent the platform config files, init throws → the keyless
// [NoopPushService] stays active and nothing here runs (no crash, no blocking).
//
// Enabling real push (an OPS step — these files are PROJECT SECRETS, NOT in the
// repo):
//   android/app/google-services.json  +  the google-services Gradle plugin
//   ios/Runner/GoogleService-Info.plist  +  an APNs auth key in the Firebase
//     console (Project settings → Cloud Messaging → Apple app configuration)
// ─────────────────────────────────────────────────────────────────────────────

import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'push_service.dart';

/// Background / terminated-state message handler. MUST be a top-level (or
/// static) function so the FCM SDK can invoke it in its own isolate. We don't
/// need to do work here (the system tray shows the notification automatically
/// when the app is backgrounded); it exists so the plugin has a registered
/// handler and background data messages don't warn.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // Intentionally minimal: tray display is handled by the OS for background
  // messages; the tap is delivered to [onTap] via getInitialMessage /
  // onMessageOpenedApp once the app is resumed.
}

/// FCM-backed [PushService]. Requests permission, obtains the device token,
/// streams refreshes to the registration callback, and routes incoming messages
/// (foreground banner + notification-tap deep link) to the supplied handlers.
///
/// Every entry point is defensively wrapped so a misconfigured Firebase project
/// degrades to "no push" rather than throwing into the auth flow.
class FirebasePushService implements PushService {
  FirebasePushService();

  String? _token;
  StreamSubscription<String>? _refreshSub;
  StreamSubscription<RemoteMessage>? _foregroundSub;
  StreamSubscription<RemoteMessage>? _openedSub;

  @override
  bool get isAvailable => true;

  @override
  String? get currentToken => _token;

  @override
  Future<void> start(
    void Function(String token, String platform) onToken, {
    PushMessageHandlers handlers = const PushMessageHandlers(),
  }) async {
    final platform = currentPushPlatform();
    if (platform == null) return; // unsupported OS (web/desktop)

    try {
      final messaging = FirebaseMessaging.instance;

      // iOS / Android 13+ require explicit permission before tokens deliver.
      final settings = await messaging.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        if (kDebugMode) debugPrint('[push] notification permission denied');
        return;
      }

      // Wire message routing BEFORE fetching the token so we don't miss an
      // early foreground message.
      _wireMessageHandlers(messaging, handlers);

      // Current token (may be null transiently on iOS before APNs is ready).
      final token = await messaging.getToken();
      if (token != null && token.isNotEmpty) {
        _token = token;
        onToken(token, platform);
      }

      // Future refreshes (re-register so the backend always has a live token).
      _refreshSub = messaging.onTokenRefresh.listen((t) {
        if (t.isEmpty) return;
        _token = t;
        onToken(t, platform);
      });
    } catch (e) {
      // Misconfigured project / APNs not ready / plugin missing — degrade to
      // "no push" rather than break the authenticated transition.
      if (kDebugMode) debugPrint('[push] FirebasePushService.start failed (ignored): $e');
    }
  }

  /// Subscribe to the three message channels: foreground (show in-app), opened
  /// from background (deep-link), and the initial message that launched a
  /// terminated app from a notification tap.
  void _wireMessageHandlers(FirebaseMessaging messaging, PushMessageHandlers handlers) {
    _foregroundSub = FirebaseMessaging.onMessage.listen((message) {
      final onForeground = handlers.onForeground;
      if (onForeground != null) onForeground(_toPushMessage(message));
    });

    _openedSub = FirebaseMessaging.onMessageOpenedApp.listen((message) {
      final onTap = handlers.onTap;
      if (onTap != null) onTap(_toPushMessage(message));
    });

    // App launched from a terminated state by tapping a notification.
    unawaited(messaging.getInitialMessage().then((message) {
      if (message == null) return;
      final onTap = handlers.onTap;
      if (onTap != null) onTap(_toPushMessage(message));
    }));
  }

  /// Map an FCM [RemoteMessage] to the app's transport-agnostic [PushMessage].
  PushMessage _toPushMessage(RemoteMessage message) {
    return PushMessage.fromData(
      message.data,
      title: message.notification?.title,
      body: message.notification?.body,
    );
  }

  @override
  Future<void> stop() async {
    await _refreshSub?.cancel();
    await _foregroundSub?.cancel();
    await _openedSub?.cancel();
    _refreshSub = null;
    _foregroundSub = null;
    _openedSub = null;
    _token = null;
  }
}
