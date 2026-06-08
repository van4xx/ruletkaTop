import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api.dart';
import '../di/providers.dart';
import '../models/models.dart';
import '../router/router.dart';
import 'push_service.dart';

/// The active [PushService]. Defaults to the keyless [NoopPushService] so the
/// app boots and runs WITHOUT Firebase config — and so the FIRST FRAME never
/// waits on a native Firebase round-trip.
///
/// Push is resolved AFTER the first frame (see `main.dart`), then published here
/// via [setActivePushService]. The provider reads the late-bound holder, so a
/// consumer that resolves it before resolution settles briefly sees the no-op
/// (acceptable — push only starts post-authentication, long after boot).
PushService _activePushService = const NoopPushService();

/// Publish the resolved [PushService] (called once after the first frame, after
/// the guarded `Firebase.initializeApp()`). Idempotent and synchronous.
void setActivePushService(PushService service) {
  _activePushService = service;
}

final pushServiceProvider = Provider<PushService>((ref) {
  return _activePushService;
});

/// Drives push registration for the signed-in device.
///
/// [start] kicks off token acquisition via the active [PushService] and
/// registers each token (current + refreshes) with the backend. [stop]
/// best-effort unregisters the last token (on logout). Idempotent: calling
/// [start] twice won't double-register the same token.
class PushController {
  PushController(this._ref);

  final Ref _ref;

  bool _started = false;
  String? _lastRegistered;

  PushService get _push => _ref.read(pushServiceProvider);
  // The device-token endpoints live on the shared ApiClient (ApiEndpoints
  // extension) — used directly here so `core/push` stays free of feature deps.
  ApiClient get _api => _ref.read(apiClientProvider);

  /// Begin push registration. Safe to call when push is unavailable (no-op).
  Future<void> start() async {
    if (_started) return;
    _started = true;
    try {
      await _push.start(
        _onToken,
        handlers: PushMessageHandlers(
          onForeground: _showForeground,
          onTap: _openDeepLink,
        ),
      );
    } catch (e) {
      if (kDebugMode) debugPrint('[push] start failed (ignored): $e');
    }
  }

  /// A push arrived while the app is foregrounded: FCM does NOT raise a system
  /// tray entry in that case, so surface it as an in-app banner (a tap on the
  /// banner action deep-links to it).
  void _showForeground(PushMessage message) {
    final context = _navigatorContext;
    if (context == null) return;
    final messenger = ScaffoldMessenger.maybeOf(context);
    if (messenger == null) return;
    final title = message.title ?? 'Уведомление';
    final body = message.body;
    messenger
      ..clearSnackBars()
      ..showSnackBar(
        SnackBar(
          content: Text(body == null || body.isEmpty ? title : '$title — $body'),
          behavior: SnackBarBehavior.floating,
          action: message.link == null
              ? null
              : SnackBarAction(
                  label: 'Открыть',
                  onPressed: () => _openDeepLink(message),
                ),
        ),
      );
  }

  /// Route a notification tap to its canonical in-app deep link (e.g.
  /// `/chats/:id`). No-op when the message carries no link or routing fails.
  void _openDeepLink(PushMessage message) {
    final link = message.link;
    if (link == null || link.isEmpty) return;
    try {
      _ref.read(routerProvider).go(link);
    } catch (e) {
      if (kDebugMode) debugPrint('[push] deep-link to $link failed (ignored): $e');
    }
  }

  /// The current navigator's BuildContext (via the router's navigator key), or
  /// null if the app isn't mounted yet.
  BuildContext? get _navigatorContext =>
      _ref.read(routerProvider).routerDelegate.navigatorKey.currentContext;

  void _onToken(String token, String platform) {
    if (token.isEmpty || token == _lastRegistered) return;
    _lastRegistered = token;
    // Fire-and-forget; a failed registration is non-fatal (we retry on the
    // next refresh / next app start).
    _api
        .registerPushDeviceToken(
            DevicePushTokenDto(token: token, platform: platform))
        .catchError((Object e) {
      if (kDebugMode) debugPrint('[push] device-token register failed: $e');
    });
  }

  /// Stop listening and unregister the last token (best-effort, on logout).
  Future<void> stop() async {
    _started = false;
    final token = _lastRegistered;
    _lastRegistered = null;
    try {
      await _push.stop();
    } catch (_) {/* ignore */}
    if (token != null && token.isNotEmpty) {
      try {
        await _api.unregisterPushDeviceToken(token);
      } catch (_) {/* best-effort */}
    }
  }
}

/// DI: the push registration controller (singleton).
final pushControllerProvider = Provider<PushController>((ref) {
  return PushController(ref);
});
