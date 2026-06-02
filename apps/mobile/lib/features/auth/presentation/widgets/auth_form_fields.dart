import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../../domain/auth_options.dart';

/// A segmented (pill) single-choice selector — the mobile analogue of the web's
/// `SegmentedControl`. Used for gender + interface language on the register
/// screen. Generic over the choice value [T].
class SegmentedChoice<T> extends StatelessWidget {
  const SegmentedChoice({
    super.key,
    required this.options,
    required this.value,
    required this.onChanged,
  });

  final List<Choice<T>> options;
  final T value;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;

    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.4),
        borderRadius: AppRadii.brMd,
        border: Border.all(color: colors.glassBorder),
      ),
      child: Row(
        children: [
          for (final option in options)
            Expanded(
              child: _Segment(
                label: option.label,
                selected: option.value == value,
                onTap: () => onChanged(option.value),
              ),
            ),
        ],
      ),
    );
  }
}

class _Segment extends StatelessWidget {
  const _Segment({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;

    return AnimatedContainer(
      duration: AppDurations.fast,
      curve: Curves.easeOut,
      decoration: BoxDecoration(
        borderRadius: AppRadii.brSm,
        gradient: selected ? LinearGradient(colors: colors.ctaGradient) : null,
        boxShadow:
            selected ? AppShadows.glow(colors.neonViolet, strength: 0.35) : null,
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: AppRadii.brSm,
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
            child: Text(
              label,
              textAlign: TextAlign.center,
              style: context.texts.labelLarge?.copyWith(
                color: selected ? Colors.white : scheme.onSurfaceVariant,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A password [TextFormField] with a show/hide toggle and an optional strength
/// meter (used on register). The strength heuristic mirrors the web's meter:
/// length + character-class variety.
class PasswordField extends StatefulWidget {
  const PasswordField({
    super.key,
    required this.controller,
    this.label = 'Пароль',
    this.hint,
    this.showStrength = false,
    this.textInputAction,
    this.autofillHints,
    this.validator,
    this.onChanged,
    this.onSubmitted,
  });

  final TextEditingController controller;
  final String label;
  final String? hint;
  final bool showStrength;
  final TextInputAction? textInputAction;
  final Iterable<String>? autofillHints;
  final String? Function(String?)? validator;
  final ValueChanged<String>? onChanged;
  final VoidCallback? onSubmitted;

  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  bool _obscure = true;
  String _value = '';

  @override
  void initState() {
    super.initState();
    _value = widget.controller.text;
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextFormField(
          controller: widget.controller,
          obscureText: _obscure,
          autofillHints: widget.autofillHints,
          textInputAction: widget.textInputAction,
          onFieldSubmitted: (_) => widget.onSubmitted?.call(),
          decoration: InputDecoration(
            labelText: widget.label,
            helperText: widget.hint,
            prefixIcon: const Icon(Icons.lock_outline_rounded),
            suffixIcon: IconButton(
              tooltip: _obscure ? 'Показать' : 'Скрыть',
              onPressed: () => setState(() => _obscure = !_obscure),
              icon: Icon(_obscure
                  ? Icons.visibility_outlined
                  : Icons.visibility_off_outlined),
            ),
          ),
          validator: widget.validator,
          onChanged: (v) {
            if (widget.showStrength) setState(() => _value = v);
            widget.onChanged?.call(v);
          },
        ),
        if (widget.showStrength && _value.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.sm),
          _StrengthMeter(score: _passwordScore(_value)),
        ],
      ],
    );
  }
}

/// 0–4 strength score: +1 for length ≥ 8, ≥ 12, and for digit + non-alnum
/// presence (mirrors the web's lightweight meter).
int _passwordScore(String value) {
  var score = 0;
  if (value.length >= 8) score++;
  if (value.length >= 12) score++;
  if (RegExp(r'\d').hasMatch(value)) score++;
  if (RegExp(r'[^A-Za-z0-9]').hasMatch(value)) score++;
  return score.clamp(0, 4);
}

class _StrengthMeter extends StatelessWidget {
  const _StrengthMeter({required this.score});

  final int score;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final (label, color) = switch (score) {
      <= 1 => ('Слабый', context.scheme.error),
      2 => ('Средний', colors.warning),
      3 => ('Хороший', colors.neonCyan),
      _ => ('Надёжный', colors.success),
    };

    return Row(
      children: [
        Expanded(
          child: Row(
            children: [
              for (var i = 0; i < 4; i++) ...[
                if (i > 0) const SizedBox(width: 4),
                Expanded(
                  child: AnimatedContainer(
                    duration: AppDurations.fast,
                    height: 4,
                    decoration: BoxDecoration(
                      color: i < score
                          ? color
                          : context.scheme.surfaceContainerHighest,
                      borderRadius: AppRadii.brPill,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Text(
          label,
          style: context.texts.labelSmall?.copyWith(color: color),
        ),
      ],
    );
  }
}

/// A read-only "field" that opens a searchable country picker sheet. Renders
/// the selected country's flag + name (or a placeholder) and surfaces a
/// validation [errorText] in the Material input style.
class CountryPickerField extends StatelessWidget {
  const CountryPickerField({
    super.key,
    required this.value,
    required this.onChanged,
    this.label = 'Страна',
    this.errorText,
  });

  /// Selected ISO alpha-2 code (or null).
  final String? value;
  final ValueChanged<String> onChanged;
  final String label;
  final String? errorText;

  @override
  Widget build(BuildContext context) {
    final selectedName = value != null ? kCountryNameByCode[value] : null;

    return InkWell(
      borderRadius: AppRadii.brMd,
      onTap: () async {
        final picked = await showCountryPickerSheet(context, selected: value);
        if (picked != null) onChanged(picked);
      },
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          errorText: errorText,
          prefixIcon: const Icon(Icons.public_rounded),
          suffixIcon: const Icon(Icons.expand_more_rounded),
        ),
        child: Row(
          children: [
            if (value != null) ...[
              CountryFlag(countryCode: value, size: 20),
              const SizedBox(width: AppSpacing.sm),
              Expanded(child: Text(selectedName ?? value!)),
            ] else
              Expanded(
                child: Text(
                  'Выберите страну',
                  style: TextStyle(color: context.scheme.onSurfaceVariant),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Opens the modal country picker and resolves to the chosen code (or null if
/// dismissed). A searchable, scrollable glass sheet over the scrim.
Future<String?> showCountryPickerSheet(
  BuildContext context, {
  String? selected,
}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: context.scheme.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadii.xxl)),
    ),
    builder: (_) => _CountryPickerSheet(selected: selected),
  );
}

class _CountryPickerSheet extends StatefulWidget {
  const _CountryPickerSheet({this.selected});

  final String? selected;

  @override
  State<_CountryPickerSheet> createState() => _CountryPickerSheetState();
}

class _CountryPickerSheetState extends State<_CountryPickerSheet> {
  String _query = '';

  List<CountryOption> get _filtered {
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return kCountries;
    return kCountries
        .where((c) =>
            c.name.toLowerCase().contains(q) || c.code.toLowerCase().contains(q))
        .toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    final colors = context.colors;
    final results = _filtered;
    // Cap the sheet at ~80% of the screen so it never covers everything.
    final maxHeight = MediaQuery.sizeOf(context).height * 0.8;

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: maxHeight),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.md),
              child: TextField(
                autofocus: true,
                onChanged: (v) => setState(() => _query = v),
                decoration: const InputDecoration(
                  hintText: 'Поиск страны',
                  prefixIcon: Icon(Icons.search_rounded),
                ),
              ),
            ),
            Flexible(
              child: results.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.all(AppSpacing.xxl),
                      child: EmptyState(
                        icon: Icons.public_off_rounded,
                        title: 'Ничего не найдено',
                        message: 'Попробуйте другой запрос.',
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
                      itemCount: results.length,
                      itemBuilder: (context, i) {
                        final c = results[i];
                        final selected = c.code == widget.selected;
                        return ListTile(
                          leading: CountryFlag(countryCode: c.code, size: 26),
                          title: Text(c.name),
                          trailing: selected
                              ? Icon(Icons.check_rounded, color: colors.neonViolet)
                              : Text(
                                  c.code,
                                  style: context.texts.labelSmall?.copyWith(
                                    color: scheme.onSurfaceVariant,
                                  ),
                                ),
                          selected: selected,
                          onTap: () => Navigator.of(context).pop(c.code),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A read-only date "field" that opens the platform date picker, constrained to
/// the 18+ window. Renders the chosen date (or placeholder) + a validation
/// [errorText].
class BirthDateField extends StatelessWidget {
  const BirthDateField({
    super.key,
    required this.value,
    required this.onChanged,
    required this.lastDate,
    this.label = 'Дата рождения',
    this.errorText,
  });

  final DateTime? value;
  final ValueChanged<DateTime> onChanged;

  /// Latest selectable date (the 18-years-ago boundary).
  final DateTime lastDate;
  final String label;
  final String? errorText;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: AppRadii.brMd,
      onTap: () async {
        final picked = await showDatePicker(
          context: context,
          initialDate: value ?? lastDate,
          firstDate: DateTime(1920),
          lastDate: lastDate,
          helpText: 'Дата рождения',
        );
        if (picked != null) onChanged(picked);
      },
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          errorText: errorText,
          prefixIcon: const Icon(Icons.cake_outlined),
          suffixIcon: const Icon(Icons.calendar_today_rounded, size: 18),
        ),
        child: Text(
          value != null
              ? _formatDate(value!)
              : 'дд.мм.гггг',
          style: value == null
              ? TextStyle(color: context.scheme.onSurfaceVariant)
              : null,
        ),
      ),
    );
  }

  static String _formatDate(DateTime d) {
    final dd = d.day.toString().padLeft(2, '0');
    final mm = d.month.toString().padLeft(2, '0');
    return '$dd.$mm.${d.year}';
  }
}

/// Reusable digits-only / latin formatter for the nickname field (so the input
/// can't contain characters `nicknameSchema` would reject).
final nicknameFormatter =
    FilteringTextInputFormatter.allow(RegExp(r'[a-zA-Z0-9_]'));
