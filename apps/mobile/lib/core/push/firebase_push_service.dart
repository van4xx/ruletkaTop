// ─────────────────────────────────────────────────────────────────────────────
// OPT-IN Firebase Cloud Messaging implementation of [PushService].
//
// This file is intentionally DORMANT until the integrator enables push:
//   1. Add deps to pubspec.yaml (already listed there, commented):
//        firebase_core: ^4.1.0
//        firebase_messaging: ^16.1.0
//      then `flutter pub get`.
//   2. Add the platform config files (an OPS step — NOT committed here):
//        android/app/google-services.json
//        ios/Runner/GoogleService-Info.plist
//      and the Gradle/CocoaPods Firebase setup per the FlutterFire docs.
//   3. Uncomment the two `import` lines and the implementation body below
//      (delete the "DORMANT" stub between the markers).
//   4. In main.dart, initialize Firebase before runApp and override the
//      provider:
//        await Firebase.initializeApp(/* DefaultFirebaseOptions.currentPlatform */);
//        runApp(ProviderScope(
//          overrides: [pushServiceProvider.overrideWithValue(FirebasePushService())],
//          child: const RuletkaApp(),
//        ));
//
// Kept dormant (not the imports live) so the app COMPILES and RUNS today
// without the Firebase packages installed — the keyless [NoopPushService] is
// the default, and nothing imports this file until push is turned on.
// ─────────────────────────────────────────────────────────────────────────────

import 'dart:async';

import 'package:flutter/foundation.dart';

// ↓↓↓ STEP 3: uncomment these once the firebase deps are installed. ↓↓↓
// import 'package:firebase_messaging/firebase_messaging.dart';

import 'push_service.dart';

/// FCM-backed [PushService]. Requests permission, obtains the device token and
/// streams refreshes to the registration callback. Requires `firebase_core` +
/// `firebase_messaging` and a configured Firebase project (see file header).
class FirebasePushService implements PushService {
  FirebasePushService();

  String? _token;
  StreamSubscription<dynamic>? _refreshSub;

  @override
  bool get isAvailable => true;

  @override
  String? get currentToken => _token;

  // ───────────────────────── DORMANT STUB (delete on enable) ────────────────
  // While the firebase deps are absent this stub keeps the file compiling and
  // behaves like the no-op. Remove this block and uncomment the LIVE block
  // below once you've completed steps 1–2 in the file header.
  @override
  Future<void> start(void Function(String token, String platform) onToken) async {
    if (kDebugMode) {
      debugPrint('[push] FirebasePushService is dormant — enable it by '
          'following the steps in firebase_push_service.dart.');
    }
  }

  @override
  Future<void> stop() async {
    await _refreshSub?.cancel();
    _refreshSub = null;
    _token = null;
  }
  // ─────────────────────────── END DORMANT STUB ─────────────────────────────

  // ───────────────────────────── LIVE IMPL (enable) ─────────────────────────
  // Uncomment everything between the markers (and delete the stub above) after
  // installing the firebase deps + uncommenting the import.
  //
  // @override
  // Future<void> start(void Function(String token, String platform) onToken) async {
  //   final platform = currentPushPlatform();
  //   if (platform == null) return; // unsupported OS (web/desktop)
  //   final messaging = FirebaseMessaging.instance;
  //
  //   // iOS / Android 13+ require explicit permission before tokens deliver.
  //   final settings = await messaging.requestPermission();
  //   if (settings.authorizationStatus == AuthorizationStatus.denied) {
  //     if (kDebugMode) debugPrint('[push] notification permission denied');
  //     return;
  //   }
  //
  //   // Current token (may be null transiently on iOS before APNs is ready).
  //   final token = await messaging.getToken();
  //   if (token != null && token.isNotEmpty) {
  //     _token = token;
  //     onToken(token, platform);
  //   }
  //
  //   // Future refreshes.
  //   _refreshSub = messaging.onTokenRefresh.listen((t) {
  //     if (t.isEmpty) return;
  //     _token = t;
  //     onToken(t, platform);
  //   });
  // }
  //
  // @override
  // Future<void> stop() async {
  //   await _refreshSub?.cancel();
  //   _refreshSub = null;
  //   _token = null;
  // }
  // ─────────────────────────────── END LIVE IMPL ────────────────────────────
}
