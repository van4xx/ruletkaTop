import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api.dart';
import '../di/providers.dart';
import '../models/models.dart';
import 'push_service.dart';

/// The active [PushService]. Defaults to the keyless [NoopPushService] so the
/// app boots and runs WITHOUT Firebase config.
///
/// To enable real push, the integrator overrides this in `main.dart`'s
/// [ProviderScope] (after `Firebase.initializeApp()`), e.g.:
///
/// ```dart
/// ProviderScope(
///   overrides: [
///     pushServiceProvider.overrideWithValue(FirebasePushService()),
///   ],
///   child: const RuletkaApp(),
/// )
/// ```
final pushServiceProvider = Provider<PushService>((ref) {
  return const NoopPushService();
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
      await _push.start(_onToken);
    } catch (e) {
      if (kDebugMode) debugPrint('[push] start failed (ignored): $e');
    }
  }

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
