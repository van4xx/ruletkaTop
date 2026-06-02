import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/api.dart';
import '../socket/socket.dart';
import 'auth_controller.dart';

/// ─────────────────────────────────────────────────────────────────────────
/// Dependency injection graph (Riverpod 3.x).
///
/// Feature agents READ these providers; they should NOT re-create the API
/// client, socket or token store. Watch [authStateProvider] for the session,
/// and call methods on [authControllerProvider.notifier] to mutate it.
///
/// Construction order: secureStorage → tokenStore → apiClient → socketService,
/// then [authControllerProvider] ties them together.
/// ─────────────────────────────────────────────────────────────────────────

/// Platform secure storage (Keychain / EncryptedSharedPreferences).
final secureStorageProvider = Provider<FlutterSecureStorage>((ref) {
  return TokenStore.createStorage();
});

/// In-memory access token + secure-storage refresh token holder.
final tokenStoreProvider = Provider<TokenStore>((ref) {
  return TokenStore(ref.watch(secureStorageProvider));
});

/// The typed REST client (Dio + interceptors). Use the [ApiEndpoints]
/// extension methods on it (e.g. `ref.read(apiClientProvider).friends()`).
final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(ref.watch(tokenStoreProvider));
});

/// The realtime socket wrapper. Connected/disconnected by [AuthController] on
/// auth transitions; feature code subscribes via its typed `on*` helpers.
final socketServiceProvider = Provider<SocketService>((ref) {
  final socket = SocketService(ref.watch(tokenStoreProvider));
  ref.onDispose(socket.dispose);
  return socket;
});

/// The session controller + its observable [AuthState].
final authControllerProvider =
    NotifierProvider<AuthController, AuthState>(AuthController.new);

/// Convenience: the current auth state.
final authStateProvider = authControllerProvider;

/// Convenience: the signed-in user (or `null`). Feature code that just needs
/// the current user id/nickname can watch this without the full controller.
final currentUserProvider = Provider((ref) {
  return ref.watch(authControllerProvider).user;
});

/// Convenience: the current user's id (or `null`) — handy for "is this me?"
/// checks (chat ownership, own-profile, etc.).
final currentUserIdProvider = Provider<String?>((ref) {
  return ref.watch(currentUserProvider)?.id;
});
