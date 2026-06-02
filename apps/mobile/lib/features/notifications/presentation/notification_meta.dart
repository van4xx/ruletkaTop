import 'package:flutter/material.dart';

import '../../../core/models/models.dart';
import '../../../core/theme/theme.dart';

/// Per-[NotificationKind] presentation metadata (icon + accent + a short
/// Russian category label) and a compact relative-time formatter. Mirrors the
/// web's `components/notifications/notification-meta.ts`.
abstract final class NotificationMeta {
  /// The glyph for a notification kind.
  static IconData icon(NotificationKind kind) => switch (kind) {
        NotificationKind.friendRequest => Icons.person_add_alt_1_rounded,
        NotificationKind.message => Icons.chat_bubble_rounded,
        NotificationKind.gift => Icons.card_giftcard_rounded,
        NotificationKind.call => Icons.videocam_rounded,
        NotificationKind.system => Icons.notifications_rounded,
      };

  /// The accent color for a notification kind, pulled from the neon palette.
  static Color accent(BuildContext context, NotificationKind kind) {
    final colors = context.colors;
    return switch (kind) {
      NotificationKind.friendRequest => colors.neonViolet,
      NotificationKind.message => colors.neonCyan,
      NotificationKind.gift => colors.neonMagenta,
      NotificationKind.call => colors.success,
      NotificationKind.system => colors.warning,
    };
  }

  /// A short category label (Russian).
  static String label(NotificationKind kind) => switch (kind) {
        NotificationKind.friendRequest => 'Заявка в друзья',
        NotificationKind.message => 'Сообщение',
        NotificationKind.gift => 'Подарок',
        NotificationKind.call => 'Звонок',
        NotificationKind.system => 'Система',
      };

  /// Compact relative time since [time]: `сейчас`, `5 мин`, `3 ч`, `2 дн`, or a
  /// short date for anything older than a week.
  static String relativeTime(DateTime time) {
    final diff = DateTime.now().difference(time);
    if (diff.isNegative || diff.inSeconds < 45) return 'сейчас';
    if (diff.inMinutes < 60) {
      final m = diff.inMinutes;
      return '$m мин';
    }
    if (diff.inHours < 24) {
      final h = diff.inHours;
      return '$h ч';
    }
    if (diff.inDays < 7) {
      final d = diff.inDays;
      return '$d ${_plural(d, 'день', 'дня', 'дней')}';
    }
    final local = time.toLocal();
    final dd = local.day.toString().padLeft(2, '0');
    final mm = local.month.toString().padLeft(2, '0');
    return '$dd.$mm';
  }

  /// Russian-correct plural selector.
  static String _plural(int n, String one, String few, String many) {
    final mod10 = n % 10;
    final mod100 = n % 100;
    if (mod10 == 1 && mod100 != 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  }
}
