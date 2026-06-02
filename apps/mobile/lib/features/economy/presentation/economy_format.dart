import 'package:intl/intl.dart';

import '../../../core/models/models.dart';

/// Locale-aware formatting helpers shared across the economy screens.
/// Russian-first product → default to the `ru` locale (mirrors the web's
/// `features/economy/format.ts`).
abstract final class EconomyFormat {
  static final NumberFormat _number = NumberFormat.decimalPattern('ru');
  static final DateFormat _dateTime = DateFormat('d MMM, HH:mm', 'ru');
  static final DateFormat _date = DateFormat('d MMMM yyyy', 'ru');

  /// Group a coin/number figure: `12500` → `12 500` (thin grouping).
  static String number(int value) => _number.format(value);

  /// A signed coin delta: `+250`, `-50`.
  static String signed(int value) =>
      value > 0 ? '+${number(value)}' : number(value);

  /// Format a rouble price: `499` → `499 ₽`.
  static String rub(int value) => '${_number.format(value)} ₽';

  /// Human date-time for ledger rows: `31 мая, 14:05`.
  static String dateTime(DateTime d) => _dateTime.format(d.toLocal());

  /// Full date: `31 мая 2026`.
  static String date(DateTime d) => _date.format(d.toLocal());

  /// Compact remaining time until [instant]: `5 ч 12 мин`, `3 дн 4 ч`.
  static String timeLeft(DateTime instant) {
    final ms = instant.difference(DateTime.now()).inMilliseconds;
    if (ms <= 0) return 'истекло';
    final minutes = ms ~/ 60000;
    final days = minutes ~/ 1440;
    final hours = (minutes % 1440) ~/ 60;
    final mins = minutes % 60;
    if (days > 0) return hours > 0 ? '$days дн $hours ч' : '$days дн';
    if (hours > 0) return '$hours ч $mins мин';
    return '$mins мин';
  }

  /// Price-per-coin (incl. bonus) — used to highlight the best-value package.
  static double pricePerCoin(CoinPackage pkg) {
    final total = pkg.coins + pkg.bonusCoins;
    return total > 0 ? pkg.priceRub / total : double.infinity;
  }

  /// Russian-correct plural: `(1, 'день', 'дня', 'дней')`.
  static String plural(int n, String one, String few, String many) {
    final mod10 = n % 10;
    final mod100 = n % 100;
    if (mod10 == 1 && mod100 != 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  }

  /// Human label for a coin-ledger entry type.
  static String txTypeLabel(CoinTxType type) => switch (type) {
        CoinTxType.purchase => 'Пополнение',
        CoinTxType.giftOut => 'Отправлен подарок',
        CoinTxType.giftIn => 'Получен подарок',
        CoinTxType.top => 'Место в Топе',
        CoinTxType.bonus => 'Бонус',
        CoinTxType.refund => 'Возврат',
      };

  /// Interval label for a premium plan (`/ мес`, `/ нед`, `/ 7 дн`).
  static String planInterval(int intervalDays) {
    if (intervalDays % 30 == 0) {
      final m = intervalDays ~/ 30;
      return m == 1 ? '/ мес' : '/ $m ${plural(m, 'мес', 'мес', 'мес')}';
    }
    if (intervalDays % 7 == 0) {
      final w = intervalDays ~/ 7;
      return w == 1 ? '/ нед' : '/ $w ${plural(w, 'неделю', 'недели', 'недель')}';
    }
    return '/ $intervalDays ${plural(intervalDays, 'день', 'дня', 'дней')}';
  }
}
