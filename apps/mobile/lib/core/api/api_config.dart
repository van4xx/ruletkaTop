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

  /// The bare API ORIGIN (scheme + host[:port], NO `/api` suffix) — used to
  /// absolutize the server-relative media paths the API hands back (avatars are
  /// served at `/uploads/avatars/...`, NOT under `/api`). Derived from
  /// [baseUrl] by stripping a trailing `/api`.
  static String get assetOrigin {
    final base = baseUrl;
    final uri = Uri.tryParse(base);
    if (uri != null && uri.hasScheme) {
      return Uri(scheme: uri.scheme, host: uri.host, port: uri.hasPort ? uri.port : null)
          .toString();
    }
    return 'http://$_host:$_port';
  }

  /// Resolve a possibly-relative media path (e.g. `/uploads/avatars/x.webp`) to
  /// an absolute URL the image loader can fetch. Absolute http(s) URLs and data
  /// URIs are returned unchanged; null/empty yields null.
  static String? resolveMediaUrl(String? url) {
    final value = url?.trim();
    if (value == null || value.isEmpty) return null;
    if (value.startsWith('http://') ||
        value.startsWith('https://') ||
        value.startsWith('data:')) {
      return value;
    }
    final origin = assetOrigin;
    return value.startsWith('/') ? '$origin$value' : '$origin/$value';
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

  /// Public WEBSITE origin (no trailing slash) — where the legal/help pages and
  /// the email-link landing pages live. The mobile app links OUT to these. A
  /// `--dart-define=WEB_BASE_URL=https://ruletka.top` wins; otherwise we default
  /// to the production site (the legal pages are static + public).
  static String get webBaseUrl {
    const fromDefine = String.fromEnvironment('WEB_BASE_URL');
    if (fromDefine.isNotEmpty) {
      return fromDefine.endsWith('/')
          ? fromDefine.substring(0, fromDefine.length - 1)
          : fromDefine;
    }
    return 'https://ruletka.top';
  }

  /// Canonical legal-document URLs (mirror the web routes in
  /// `apps/web/src/config/nav.ts`: Terms → `/rules`, Privacy → `/privacy`).
  static String get termsUrl => '$webBaseUrl/rules';
  static String get privacyUrl => '$webBaseUrl/privacy';

  /// Default network timeouts.
  static const Duration connectTimeout = Duration(seconds: 15);
  static const Duration receiveTimeout = Duration(seconds: 20);
}
