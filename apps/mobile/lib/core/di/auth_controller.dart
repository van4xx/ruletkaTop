import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api.dart';
import '../models/models.dart';
import '../push/push_providers.dart';
import '../socket/socket.dart';
import 'providers.dart';

/// High-level authentication status used by the router guard.
enum AuthStatus {
  /// Bootstrap not finished yet (showing the splash). The guard holds routing
  /// until this resolves so we don't flash the login screen on a warm start.
  unknown,
  authenticated,
  unauthenticated,
}

/// Immutable auth state: the [status], the signed-in [user] (when
/// authenticated) and a transient [errorMessage] from the last failed action.
@immutable
class AuthState {
  const AuthState({
    this.status = AuthStatus.unknown,
    this.user,
    this.isBusy = false,
    this.errorMessage,
  });

  final AuthStatus status;
  final AuthUser? user;

  /// True while a login/register/logout request is in flight (drives spinners
  /// + disabled buttons on the auth screens).
  final bool isBusy;

  /// Human-readable error from the last failed auth action (Russian-first).
  final String? errorMessage;

  bool get isAuthenticated => status == AuthStatus.authenticated;
  bool get isUnknown => status == AuthStatus.unknown;

  AuthState copyWith({
    AuthStatus? status,
    AuthUser? user,
    bool? isBusy,
    String? errorMessage,
    bool clearError = false,
    bool clearUser = false,
  }) =>
      AuthState(
        status: status ?? this.status,
        user: clearUser ? null : (user ?? this.user),
        isBusy: isBusy ?? this.isBusy,
        errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      );
}

/// Owns the session lifecycle and is the source of truth the router redirects
/// on. Responsibilities:
///  * [bootstrap] — on app launch, try to restore a session from the stored
///    refresh token (mint an access token), then load the [AuthUser].
///  * [login] / [register] — authenticate, persist tokens, connect the socket.
///  * [logout] — revoke + clear tokens, disconnect the socket.
///
/// On every authenticated transition the realtime [SocketService] is connected
/// with the fresh access token; on logout it is disconnected.
class AuthController extends Notifier<AuthState> {
  ApiClient get _api => ref.read(apiClientProvider);
  TokenStore get _tokens => ref.read(tokenStoreProvider);
  SocketService get _socket => ref.read(socketServiceProvider);
  PushController get _push => ref.read(pushControllerProvider);

  @override
  AuthState build() => const AuthState();

  /// Restore a session on launch. Idempotent; safe to call once from `main`.
  Future<void> bootstrap() async {
    final refresh = await _tokens.readRefreshToken();
    if (refresh == null) {
      state = const AuthState(status: AuthStatus.unauthenticated);
      return;
    }
    // Exchange the stored refresh token for an access token, then hydrate.
    final restored = await _api.tryRestoreSession();
    if (!restored) {
      await _tokens.clear();
      state = const AuthState(status: AuthStatus.unauthenticated);
      return;
    }
    try {
      final user = await _api.me();
      _onAuthenticated(user);
    } catch (_) {
      await _tokens.clear();
      state = const AuthState(status: AuthStatus.unauthenticated);
    }
  }

  /// Log in with email + password.
  Future<bool> login(String email, String password) =>
      _run(() => _api.login(LoginDto(email: email.trim(), password: password)));

  /// Register a new account.
  Future<bool> register(RegisterDto dto) => _run(() => _api.register(dto));

  /// Run a token-minting auth action ([login]/[register]), persist tokens and
  /// transition to authenticated. Returns `true` on success; on failure the
  /// [AuthState.errorMessage] is set and `false` returned.
  Future<bool> _run(Future<AuthResponse> Function() action) async {
    state = state.copyWith(isBusy: true, clearError: true);
    try {
      final res = await action();
      await _tokens.persist(res.tokens);
      _onAuthenticated(res.user);
      return true;
    } on ApiException catch (e) {
      state = state.copyWith(
        isBusy: false,
        status: AuthStatus.unauthenticated,
        errorMessage: e.message,
      );
      return false;
    } catch (e) {
      state = state.copyWith(
        isBusy: false,
        status: AuthStatus.unauthenticated,
        errorMessage: 'Не удалось войти. Попробуйте ещё раз.',
      );
      return false;
    }
  }

  void _onAuthenticated(AuthUser user) {
    state = AuthState(status: AuthStatus.authenticated, user: user);
    // Bring the realtime layer online with the fresh access token.
    _socket.connect();
    // Register for push (no-op without Firebase config; non-throwing).
    unawaited(_push.start());
  }

  /// Refresh the cached [AuthUser] (e.g. after a profile/premium change).
  Future<void> refreshUser() async {
    if (!state.isAuthenticated) return;
    try {
      final user = await _api.me();
      state = state.copyWith(user: user);
    } catch (_) {
      // Non-fatal; keep the existing cached user.
    }
  }

  /// Optimistically patch the cached user (e.g. nickname/premium) without a
  /// round-trip. Useful for instant UI after a successful settings save.
  void patchUser({String? nickname, bool? isPremium}) {
    final current = state.user;
    if (current == null) return;
    state = state.copyWith(
      user: current.copyWith(nickname: nickname, isPremium: isPremium),
    );
  }

  /// Log out: revoke the refresh session (best-effort), clear tokens and
  /// tear the socket down.
  Future<void> logout() async {
    state = state.copyWith(isBusy: true);
    try {
      await _api.logout();
    } catch (_) {
      // Ignore — local teardown below is what matters.
    }
    // Unregister this device's push token before tearing down the session
    // (best-effort; needs the access token, so do it before clearing).
    await _push.stop();
    await _tokens.clear();
    _socket.disconnect();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  /// Clear a surfaced error (e.g. when the user edits a field).
  void clearError() {
    if (state.errorMessage != null) {
      state = state.copyWith(clearError: true);
    }
  }
}
