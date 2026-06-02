import 'package:permission_handler/permission_handler.dart';

import 'webrtc_service.dart';

/// Runtime camera/mic permission gate for the roulette.
///
/// Mobile (unlike the web) must explicitly request OS permissions before
/// `getUserMedia`. Voice mode needs the microphone only; video needs both.
/// Throws a [MediaException] with [MediaErrorKind.denied] (recoverable) or
/// [MediaErrorKind.permanentlyDenied] (must open app settings) so the UI can
/// branch — matching the web's permission error surface.
abstract final class MediaPermissions {
  /// Request the permissions required for [video] (camera+mic) or voice (mic).
  /// Returns normally when granted; throws [MediaException] otherwise.
  static Future<void> ensure({required bool video}) async {
    final permissions = <Permission>[
      Permission.microphone,
      if (video) Permission.camera,
    ];

    final statuses = await permissions.request();

    final denied = <Permission>[];
    final permanently = <Permission>[];
    for (final entry in statuses.entries) {
      final status = entry.value;
      if (status.isPermanentlyDenied || status.isRestricted) {
        permanently.add(entry.key);
      } else if (!status.isGranted && !status.isLimited) {
        denied.add(entry.key);
      }
    }

    if (permanently.isNotEmpty) {
      throw MediaException(
        MediaErrorKind.permanentlyDenied,
        video
            ? 'Доступ к камере и микрофону запрещён. Откройте настройки приложения, чтобы разрешить.'
            : 'Доступ к микрофону запрещён. Откройте настройки приложения, чтобы разрешить.',
      );
    }
    if (denied.isNotEmpty) {
      throw MediaException(
        MediaErrorKind.denied,
        video
            ? 'Нужен доступ к камере и микрофону, чтобы начать.'
            : 'Нужен доступ к микрофону, чтобы начать.',
      );
    }
  }

  /// Deep-link to the OS app settings (for the permanently-denied case).
  static Future<bool> openSettings() => openAppSettings();
}
