import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/di/di.dart';
import '../../../core/models/models.dart';

/// Loads + manages the caller's active sessions (devices) for the settings
/// Devices section: `GET /auth/sessions`, `DELETE /auth/sessions/:id` (revoke
/// one) and `DELETE /auth/sessions` (revoke all others). The requesting device
/// is flagged `current` and protected from "sign out everywhere".
class SessionsController extends AsyncNotifier<List<AuthSession>> {
  ApiClient get _api => ref.read(apiClientProvider);

  @override
  Future<List<AuthSession>> build() => _api.sessions();

  /// Re-fetch the session list (after a revoke, or pull-to-refresh).
  Future<void> refresh() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(_api.sessions);
  }

  /// Revoke one session by id, then reflect the change locally (drop it from the
  /// cached list without a refetch). Throws [ApiException] on failure.
  Future<void> revoke(String sessionId) async {
    await _api.revokeSession(sessionId);
    final current = state.value ?? const <AuthSession>[];
    state = AsyncValue.data(
      current.where((s) => s.id != sessionId).toList(growable: false),
    );
  }

  /// Revoke all OTHER sessions (keep the current device), then prune the list to
  /// just the current session. Throws [ApiException] on failure.
  Future<void> revokeOthers() async {
    await _api.revokeOtherSessions();
    final current = state.value ?? const <AuthSession>[];
    state = AsyncValue.data(
      current.where((s) => s.current).toList(growable: false),
    );
  }
}

/// The active-sessions controller for the settings Devices section.
final sessionsControllerProvider =
    AsyncNotifierProvider<SessionsController, List<AuthSession>>(
  SessionsController.new,
);
