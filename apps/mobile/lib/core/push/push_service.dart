import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';

/// Abstraction over the platform push provider (FCM on Android, APNs-via-FCM on
/// iOS). Kept behind this small interface so the rest of the app never imports
/// `firebase_*` directly and the dev build runs with a WORKING keyless default
/// (see [NoopPushService]) when Firebase isn't configured.
///
/// Lifecycle:
///  * [start] is called once the user is authenticated. It (best-effort)
///    requests notification permission, obtains the device token and hands each
///    token — current and future refreshes — to [onToken] for registration with
///    the backend (`POST /notifications/push/device-token`).
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
  /// for [DevicePushTokenDto.platform] (`'android' | 'ios'`).
  Future<void> start(void Function(String token, String platform) onToken);

  /// The most recently observed device token, if one has been obtained.
  String? get currentToken;

  /// Release any listeners/streams. Safe to call when never started.
  Future<void> stop();
}

/// The default, keyless implementation: does nothing and reports unavailable.
///
/// This is what the app boots with so it runs WITHOUT a Firebase project or
/// `google-services.json` / `GoogleService-Info.plist`. To enable real push,
/// the integrator adds the `firebase_core` + `firebase_messaging` deps and the
/// platform config files, then overrides [pushServiceProvider] with
/// `FirebasePushService` (see `firebase_push_service.dart`).
class NoopPushService implements PushService {
  const NoopPushService();

  @override
  bool get isAvailable => false;

  @override
  String? get currentToken => null;

  @override
  Future<void> start(void Function(String token, String platform) onToken) async {
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
