import 'package:flutter/material.dart';

import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';

/// A single selectable country (ISO 3166-1 alpha-2 code + Russian display
/// name). The flag emoji is derived from the code, so only `{code, name}` is
/// stored — see [CountryPickerSheet.flagOf].
class _CountryOption {
  const _CountryOption(this.code, this.name);
  final String code;
  final String name;
}

/// A bottom-sheet country picker for the search filters. Returns the chosen
/// ISO alpha-2 code via [show]; the empty string `''` means "any country" and
/// `null` means the sheet was dismissed without a choice.
///
/// The list is a broad, Russian-labelled subset (popular markets first),
/// aligned with the shared `countryCodeSchema` (uppercase alpha-2). It is kept
/// inside the search feature so the picker stays self-contained.
class CountryPickerSheet extends StatefulWidget {
  const CountryPickerSheet({super.key, this.selected});

  final String? selected;

  /// Present the picker; resolves to a country code, `''` (any), or `null`.
  static Future<String?> show(BuildContext context, {String? selected}) {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => CountryPickerSheet(selected: selected),
    );
  }

  /// The flag emoji for an ISO alpha-2 [code] (Regional Indicator Symbols).
  static String flagOf(String code) {
    final c = code.trim().toUpperCase();
    if (c.length != 2 || !RegExp(r'^[A-Z]{2}$').hasMatch(c)) return '\u{1F310}';
    const base = 0x1F1E6;
    return String.fromCharCode(base + (c.codeUnitAt(0) - 0x41)) +
        String.fromCharCode(base + (c.codeUnitAt(1) - 0x41));
  }

  /// The Russian display name for a [code], or the code itself if unknown.
  static String nameOf(String code) {
    final c = code.trim().toUpperCase();
    for (final o in _countries) {
      if (o.code == c) return o.name;
    }
    return c;
  }

  static const List<_CountryOption> _countries = [
    _CountryOption('RU', 'Россия'),
    _CountryOption('UA', 'Украина'),
    _CountryOption('BY', 'Беларусь'),
    _CountryOption('KZ', 'Казахстан'),
    _CountryOption('US', 'США'),
    _CountryOption('GB', 'Великобритания'),
    _CountryOption('DE', 'Германия'),
    _CountryOption('FR', 'Франция'),
    _CountryOption('ES', 'Испания'),
    _CountryOption('IT', 'Италия'),
    _CountryOption('PL', 'Польша'),
    _CountryOption('NL', 'Нидерланды'),
    _CountryOption('TR', 'Турция'),
    _CountryOption('BR', 'Бразилия'),
    _CountryOption('MX', 'Мексика'),
    _CountryOption('AR', 'Аргентина'),
    _CountryOption('CA', 'Канада'),
    _CountryOption('IN', 'Индия'),
    _CountryOption('ID', 'Индонезия'),
    _CountryOption('PH', 'Филиппины'),
    _CountryOption('JP', 'Япония'),
    _CountryOption('KR', 'Южная Корея'),
    _CountryOption('CN', 'Китай'),
    _CountryOption('VN', 'Вьетнам'),
    _CountryOption('TH', 'Таиланд'),
    _CountryOption('AU', 'Австралия'),
    _CountryOption('SE', 'Швеция'),
    _CountryOption('NO', 'Норвегия'),
    _CountryOption('FI', 'Финляндия'),
    _CountryOption('CZ', 'Чехия'),
    _CountryOption('RO', 'Румыния'),
    _CountryOption('AT', 'Австрия'),
    _CountryOption('CH', 'Швейцария'),
    _CountryOption('GE', 'Грузия'),
    _CountryOption('AM', 'Армения'),
    _CountryOption('AZ', 'Азербайджан'),
    _CountryOption('UZ', 'Узбекистан'),
    _CountryOption('EG', 'Египет'),
    _CountryOption('AE', 'ОАЭ'),
    _CountryOption('SA', 'Саудовская Аравия'),
  ];

  @override
  State<CountryPickerSheet> createState() => _CountryPickerSheetState();
}

class _CountryPickerSheetState extends State<CountryPickerSheet> {
  String _filter = '';

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final query = _filter.trim().toLowerCase();
    final options = query.isEmpty
        ? CountryPickerSheet._countries
        : CountryPickerSheet._countries
            .where((o) =>
                o.name.toLowerCase().contains(query) ||
                o.code.toLowerCase().contains(query))
            .toList(growable: false);

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      minChildSize: 0.4,
      maxChildSize: 0.92,
      builder: (context, scrollController) {
        return Container(
          decoration: BoxDecoration(
            color: context.scheme.surface,
            borderRadius: const BorderRadius.vertical(
                top: Radius.circular(AppRadii.xxl)),
            border: Border.all(color: colors.glassBorder),
          ),
          child: Column(
            children: [
              const SizedBox(height: AppSpacing.sm),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: colors.glassBorder,
                  borderRadius: AppRadii.brPill,
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(
                    AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.sm),
                child: Row(
                  children: [
                    Expanded(
                      child: Text('Выберите страну',
                          style: context.texts.titleMedium),
                    ),
                    TextButton(
                      onPressed: () => Navigator.of(context).pop(''),
                      child: const Text('Любая'),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                child: TextField(
                  autofocus: false,
                  onChanged: (v) => setState(() => _filter = v),
                  decoration: const InputDecoration(
                    hintText: 'Поиск страны…',
                    prefixIcon: Icon(Icons.search_rounded),
                    isDense: true,
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              Expanded(
                child: options.isEmpty
                    ? const EmptyState(
                        icon: Icons.public_off_rounded,
                        title: 'Страна не найдена',
                        message: 'Попробуйте другое название.',
                      )
                    : ListView.builder(
                        controller: scrollController,
                        padding: const EdgeInsets.only(bottom: AppSpacing.xl),
                        itemCount: options.length,
                        itemBuilder: (context, i) {
                          final o = options[i];
                          final selected = o.code == widget.selected;
                          return ListTile(
                            leading: Text(
                              CountryPickerSheet.flagOf(o.code),
                              style: const TextStyle(fontSize: 24, height: 1.1),
                            ),
                            title: Text(o.name),
                            trailing: selected
                                ? Icon(Icons.check_rounded,
                                    color: colors.neonViolet)
                                : null,
                            onTap: () => Navigator.of(context).pop(o.code),
                          );
                        },
                      ),
              ),
            ],
          ),
        );
      },
    );
  }
}
