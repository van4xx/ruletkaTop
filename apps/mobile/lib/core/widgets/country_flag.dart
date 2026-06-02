import 'package:flutter/widgets.dart';

/// Renders an ISO 3166-1 alpha-2 country code (e.g. `RU`, `US`) as its emoji
/// flag by mapping each ASCII letter to a Regional Indicator Symbol. Pure text,
/// so it needs no asset bundle and scales with [size].
///
/// Falls back to a globe glyph for invalid/empty codes.
class CountryFlag extends StatelessWidget {
  const CountryFlag({super.key, required this.countryCode, this.size = 18});

  final String? countryCode;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Text(
      _toFlagEmoji(countryCode),
      style: TextStyle(fontSize: size, height: 1.1),
    );
  }

  /// Convert a 2-letter code to its flag emoji. Each letter → the matching
  /// Regional Indicator Symbol (U+1F1E6..U+1F1FF).
  static String _toFlagEmoji(String? code) {
    final c = code?.trim().toUpperCase() ?? '';
    if (c.length != 2 || !RegExp(r'^[A-Z]{2}$').hasMatch(c)) {
      return '\u{1F310}'; // globe fallback
    }
    const base = 0x1F1E6; // Regional Indicator Symbol Letter A
    final first = base + (c.codeUnitAt(0) - 0x41);
    final second = base + (c.codeUnitAt(1) - 0x41);
    return String.fromCharCode(first) + String.fromCharCode(second);
  }
}
