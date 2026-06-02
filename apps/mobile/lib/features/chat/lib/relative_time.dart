/// Lightweight Russian-locale date/time formatting for chat & social rows,
/// mirroring the web's `apps/web/src/features/chat/lib/format.ts`. Uses
/// `package:intl` (already a foundation dependency) with explicit Russian month
/// names so no locale data needs initializing.
library;

const List<String> _monthsGenitive = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

int _startOfDay(DateTime d) => DateTime(d.year, d.month, d.day).millisecondsSinceEpoch;

String _two(int v) => v.toString().padLeft(2, '0');

/// `HH:MM` clock time of a message (local time).
String formatClock(DateTime when) {
  final local = when.toLocal();
  return '${_two(local.hour)}:${_two(local.minute)}';
}

/// Compact relative time for inbox rows ("12:30", "вчера", "3 дн", "12 мая").
String formatRelativeTime(DateTime when) {
  final date = when.toLocal();
  final now = DateTime.now();
  final diffDays = ((_startOfDay(now) - _startOfDay(date)) / 86400000).round();

  if (diffDays <= 0) return formatClock(date);
  if (diffDays == 1) return 'вчера';
  if (diffDays < 7) return '$diffDays дн';
  return '${date.day} ${_monthsGenitive[date.month - 1]}';
}

/// Human day label for thread day-separators ("Сегодня", "Вчера", "12 мая").
String formatDayLabel(DateTime when) {
  final date = when.toLocal();
  final now = DateTime.now();
  final diffDays = ((_startOfDay(now) - _startOfDay(date)) / 86400000).round();

  if (diffDays == 0) return 'Сегодня';
  if (diffDays == 1) return 'Вчера';
  final base = '${date.day} ${_monthsGenitive[date.month - 1]}';
  return date.year == now.year ? base : '$base ${date.year}';
}

/// Stable day key (local midnight epoch ms) for grouping messages by day.
int dayKey(DateTime when) => _startOfDay(when.toLocal());
