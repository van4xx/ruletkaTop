import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';

/// Environment configuration for the API + realtime endpoints.
///
/// The base URL differs per platform when talking to a backend running on the
/// developer's machine:
///   * Android emulator → `10.0.2.2` (the host loopback alias).
///   * iOS simulator / desktop / web → `localhost`.
///   * A real device → set [overrideHost] (e.g. your LAN IP) via a
///     `--dart-define=API_HOST=192.168.x.x` at build time.
///
/// Production should override the whole URL via
/// `--dart-define=API_BASE_URL=https://api.ruletka.top/api`.
abstract final class ApiConfig {
  /// Full REST base URL, e.g. `http://10.0.2.2:4000/api`. A `--dart-define`
  /// (`API_BASE_URL`) wins outright; otherwise it is derived from the host.
  static String get baseUrl {
    const fromDefine = String.fromEnvironment('API_BASE_URL');
    if (fromDefine.isNotEmpty) return fromDefine;
    return 'http://$_host:$_port/api';
  }

  /// WebSocket origin (NO `/api` suffix), e.g. `http://10.0.2.2:4000`.
  static String get wsUrl {
    const fromDefine = String.fromEnvironment('WS_URL');
    if (fromDefine.isNotEmpty) return fromDefine;
    return 'http://$_host:$_port';
  }

  static const int _port = 4000;

  /// Resolve the dev host for the current platform (override with
  /// `--dart-define=API_HOST=...` for physical devices).
  static String get _host {
    const override = String.fromEnvironment('API_HOST');
    if (override.isNotEmpty) return override;
    // Web + desktop reach the host directly on localhost.
    if (kIsWeb) return 'localhost';
    try {
      if (Platform.isAndroid) return '10.0.2.2';
    } catch (_) {
      // Platform is unavailable (e.g. tests) — fall through to localhost.
    }
    return 'localhost';
  }

  /// Default network timeouts.
  static const Duration connectTimeout = Duration(seconds: 15);
  static const Duration receiveTimeout = Duration(seconds: 20);
}
