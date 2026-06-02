import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models/models.dart';

/// Token persistence for the mobile auth strategy.
///
/// SECURITY / TRANSPORT MODEL (mobile differs from web):
///  * The web keeps the refresh token in an httpOnly cookie. Mobile has no
///    browser cookie jar, so the REFRESH token is persisted in the platform
///    secure enclave (`flutter_secure_storage` → Keychain / EncryptedShared-
///    Preferences) and presented to `POST /auth/refresh` IN THE BODY (the
///    backend accepts a legacy body refresh token when no cookie is present).
///  * The short-lived ACCESS token is held IN MEMORY only — never written to
///    disk — so it dies with the process and is re-minted from the stored
///    refresh token on next launch.
///
/// The access token is exposed synchronously (read on every request + the
/// socket handshake); refresh-token reads/writes are async (secure storage).
class TokenStore {
  TokenStore(this._storage);

  final FlutterSecureStorage _storage;

  static const _refreshKey = 'ruletka_refresh_token';

  /// In-memory access token. `null` when logged out / before bootstrap.
  String? _accessToken;

  /// Read the live access token (sync) — used by the bearer interceptor and
  /// the socket handshake.
  String? get accessToken => _accessToken;

  bool get hasAccessToken => _accessToken != null && _accessToken!.isNotEmpty;

  /// Set just the in-memory access token (e.g. after a refresh).
  void setAccessToken(String? token) {
    _accessToken = (token != null && token.isNotEmpty) ? token : null;
  }

  /// Read the persisted refresh token from secure storage.
  Future<String?> readRefreshToken() async {
    try {
      final value = await _storage.read(key: _refreshKey);
      return (value != null && value.isNotEmpty) ? value : null;
    } catch (_) {
      return null;
    }
  }

  /// Persist a new pair: access in memory, refresh in secure storage. A blank
  /// refresh token is ignored (the server blanks `tokens.refreshToken` on the
  /// cookie path, so only persist when a real token is provided).
  Future<void> persist(AuthTokens tokens) async {
    setAccessToken(tokens.accessToken);
    if (tokens.refreshToken.isNotEmpty) {
      try {
        await _storage.write(key: _refreshKey, value: tokens.refreshToken);
      } catch (_) {
        // Best-effort: a storage failure shouldn't crash auth; the session
        // simply won't survive a cold start.
      }
    }
  }

  /// Clear all tokens (logout / failed refresh).
  Future<void> clear() async {
    _accessToken = null;
    try {
      await _storage.delete(key: _refreshKey);
    } catch (_) {
      // ignore
    }
  }

  /// Hardened storage defaults. Android uses the plugin's modern cipher-backed
  /// store (the legacy `encryptedSharedPreferences` flag is deprecated in v10
  /// and ignored); iOS scopes the Keychain item to first-unlock-this-device.
  static FlutterSecureStorage createStorage() => const FlutterSecureStorage(
        iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
      );
}
