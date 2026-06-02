/// Client-side validators mirroring `packages/shared-types/src/auth.ts`
/// (`registerSchema` / `loginSchema`) so the mobile forms reject the same input
/// the API would — with friendly, Russian-first messages surfaced instantly.
///
/// The over-the-wire shape stays identical; these only layer on the *client*
/// concerns (e.g. the 18+ age gate the server also enforces).
library;

/// Minimum age, in whole years, required to register (enforced server-side too).
const int kMinAge = 18;

/// Nickname rule from `nicknameSchema`: 3–24 chars, `[A-Za-z0-9_]` only.
final RegExp _nicknameRe = RegExp(r'^[a-zA-Z0-9_]+$');

abstract final class AuthValidators {
  /// `z.string().email()` — pragmatic email check (matches the web form's UX).
  static String? email(String? raw) {
    final value = raw?.trim() ?? '';
    if (value.isEmpty) return 'Введите email';
    // Simple, permissive pattern: something@something.tld
    final ok = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(value);
    return ok ? null : 'Некорректный email';
  }

  /// Login password: just "non-empty" (`loginSchema` uses `.min(1)`).
  static String? loginPassword(String? raw) {
    if (raw == null || raw.isEmpty) return 'Введите пароль';
    return null;
  }

  /// Register password: `passwordSchema` — 8–128 chars.
  static String? newPassword(String? raw) {
    final value = raw ?? '';
    if (value.isEmpty) return 'Придумайте пароль';
    if (value.length < 8) return 'Минимум 8 символов';
    if (value.length > 128) return 'Слишком длинный пароль';
    return null;
  }

  /// `nicknameSchema` — 3–24 chars, latin/digits/underscore.
  static String? nickname(String? raw) {
    final value = raw?.trim() ?? '';
    if (value.isEmpty) return 'Введите никнейм';
    if (value.length < 3) return 'Минимум 3 символа';
    if (value.length > 24) return 'Максимум 24 символа';
    if (!_nicknameRe.hasMatch(value)) {
      return 'Только латиница, цифры и _';
    }
    return null;
  }

  /// `country` — required ISO 3166-1 alpha-2.
  static String? country(String? code) {
    if (code == null || code.isEmpty) return 'Выберите страну';
    return null;
  }

  /// Birth date: required, parseable, not in the future, and 18+.
  static String? birthDate(DateTime? date) {
    if (date == null) return 'Укажите дату рождения';
    final now = DateTime.now();
    if (date.isAfter(now)) return 'Дата не может быть в будущем';
    if (ageFromDate(date) < kMinAge) return 'Регистрация доступна с $kMinAge лет';
    return null;
  }

  /// Whole years between [date] and now.
  static int ageFromDate(DateTime date) {
    final now = DateTime.now();
    var age = now.year - date.year;
    if (now.month < date.month ||
        (now.month == date.month && now.day < date.day)) {
      age -= 1;
    }
    return age;
  }

  /// The latest birth date a registrant could have to be exactly [kMinAge].
  static DateTime maxBirthDate() {
    final now = DateTime.now();
    return DateTime(now.year - kMinAge, now.month, now.day);
  }

  /// Format a [DateTime] as the `yyyy-mm-dd` wire form `registerSchema` expects.
  static String toWireDate(DateTime d) {
    final mm = d.month.toString().padLeft(2, '0');
    final dd = d.day.toString().padLeft(2, '0');
    return '${d.year.toString().padLeft(4, '0')}-$mm-$dd';
  }
}
