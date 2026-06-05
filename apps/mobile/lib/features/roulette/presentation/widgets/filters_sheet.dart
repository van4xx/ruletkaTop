import 'package:flutter/material.dart' hide Badge;

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';

/// A small curated list of popular countries for the filter (ISO 3166-1
/// alpha-2 + Russian name). The full set isn't needed for the mobile filter UX;
/// the backend accepts any valid code.
const List<({String code, String name})> _kCountries = [
  (code: 'RU', name: 'Россия'),
  (code: 'UA', name: 'Украина'),
  (code: 'BY', name: 'Беларусь'),
  (code: 'KZ', name: 'Казахстан'),
  (code: 'US', name: 'США'),
  (code: 'GB', name: 'Великобритания'),
  (code: 'DE', name: 'Германия'),
  (code: 'FR', name: 'Франция'),
  (code: 'IT', name: 'Италия'),
  (code: 'ES', name: 'Испания'),
  (code: 'PL', name: 'Польша'),
  (code: 'TR', name: 'Турция'),
  (code: 'BR', name: 'Бразилия'),
  (code: 'IN', name: 'Индия'),
  (code: 'JP', name: 'Япония'),
  (code: 'KR', name: 'Корея'),
  (code: 'CN', name: 'Китай'),
];

const int _kAgeMin = 18;
const int _kAgeMax = 100;

const List<({GenderPreference value, String label})> _kGenders = [
  (value: GenderPreference.any, label: 'Любой'),
  (value: GenderPreference.male, label: 'Парни'),
  (value: GenderPreference.female, label: 'Девушки'),
];

/// Present the matchmaking filters editor as a glass bottom sheet. Returns the
/// applied [MatchFilters], or null if dismissed without applying. Gender +
/// country are premium-gated (mirrors the web `FiltersDialog`); the age range
/// is free for everyone.
Future<MatchFilters?> showFiltersSheet(
  BuildContext context, {
  required MatchFilters value,
  required bool isPremium,
}) {
  return showModalBottomSheet<MatchFilters>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: Colors.black.withValues(alpha: 0.55),
    builder: (_) => _FiltersSheet(value: value, isPremium: isPremium),
  );
}

/// Count of non-default active filters (for the trigger badge).
int activeFilterCount(MatchFilters f) =>
    (f.gender != GenderPreference.any ? 1 : 0) +
    (f.countries.isNotEmpty ? 1 : 0) +
    (f.ageMin != _kAgeMin || f.ageMax != _kAgeMax ? 1 : 0) +
    (f.sharedInterestsOnly ? 1 : 0);

class _FiltersSheet extends StatefulWidget {
  const _FiltersSheet({required this.value, required this.isPremium});

  final MatchFilters value;
  final bool isPremium;

  @override
  State<_FiltersSheet> createState() => _FiltersSheetState();
}

class _FiltersSheetState extends State<_FiltersSheet> {
  late GenderPreference _gender = widget.value.gender;
  late RangeValues _age = RangeValues(
    widget.value.ageMin.toDouble().clamp(
      _kAgeMin.toDouble(),
      _kAgeMax.toDouble(),
    ),
    widget.value.ageMax.toDouble().clamp(
      _kAgeMin.toDouble(),
      _kAgeMax.toDouble(),
    ),
  );
  late Set<String> _countries = {...widget.value.countries};
  late bool _sharedInterestsOnly = widget.value.sharedInterestsOnly;

  void _apply() {
    final lo = _age.start.round();
    final hi = _age.end.round();
    Navigator.of(context).pop(
      MatchFilters(
        gender: widget.isPremium ? _gender : GenderPreference.any,
        ageMin: lo <= hi ? lo : hi,
        ageMax: hi >= lo ? hi : lo,
        countries: widget.isPremium ? _countries.take(50).toList() : const [],
        // Premium gate: free users can't force shared-interests-only matching.
        sharedInterestsOnly: widget.isPremium && _sharedInterestsOnly,
      ),
    );
  }

  void _reset() {
    setState(() {
      _gender = GenderPreference.any;
      _age = const RangeValues(18, 100);
      _countries = {};
      _sharedInterestsOnly = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    final colors = context.colors;
    final premium = widget.isPremium;

    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
        ),
        child: GlassCard(
          margin: const EdgeInsets.all(AppSpacing.sm),
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg,
            AppSpacing.md,
            AppSpacing.lg,
            AppSpacing.lg,
          ),
          borderRadius: AppRadii.brXxl,
          blurSigma: AppBlur.heavy,
          intensity: 1.1,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(child: _DragHandle()),
              const SizedBox(height: AppSpacing.lg),
              Row(
                children: [
                  ShaderMask(
                    shaderCallback: (b) => LinearGradient(
                      colors: colors.brandGradient,
                    ).createShader(b),
                    child: const Icon(
                      Icons.tune_rounded,
                      size: 20,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Text(
                    'Фильтры поиска',
                    style: AppTypography.display(
                      fontSize: 20,
                      color: scheme.onSurface,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Настройте, с кем хотите общаться. Пол и страна доступны в Premium.',
                style: context.texts.bodySmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: AppSpacing.xl),

              // Gender (premium).
              _LabelRow(label: 'Пол собеседника', showPremium: !premium),
              const SizedBox(height: AppSpacing.sm),
              Opacity(
                opacity: premium ? 1 : 0.55,
                child: IgnorePointer(
                  ignoring: !premium,
                  child: Row(
                    children: [
                      for (final g in _kGenders) ...[
                        Expanded(
                          child: _SegmentChip(
                            label: g.label,
                            selected: _gender == g.value,
                            onTap: () => setState(() => _gender = g.value),
                          ),
                        ),
                        if (g.value != _kGenders.last.value)
                          const SizedBox(width: AppSpacing.sm),
                      ],
                    ],
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.xl),

              // Age (free).
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Возраст', style: context.texts.titleSmall),
                  Text(
                    '${_age.start.round()}–${_age.end.round()}',
                    style: context.texts.titleSmall?.copyWith(
                      color: colors.neonCyan,
                    ),
                  ),
                ],
              ),
              RangeSlider(
                min: _kAgeMin.toDouble(),
                max: _kAgeMax.toDouble(),
                divisions: _kAgeMax - _kAgeMin,
                values: _age,
                labels: RangeLabels(
                  '${_age.start.round()}',
                  '${_age.end.round()}',
                ),
                onChanged: (v) => setState(() => _age = v),
              ),
              const SizedBox(height: AppSpacing.md),

              // Countries (premium).
              _LabelRow(label: 'Страны', showPremium: !premium),
              const SizedBox(height: AppSpacing.sm),
              Opacity(
                opacity: premium ? 1 : 0.55,
                child: IgnorePointer(
                  ignoring: !premium,
                  child: Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: [
                      for (final c in _kCountries)
                        _CountryChip(
                          code: c.code,
                          name: c.name,
                          selected: _countries.contains(c.code),
                          onTap: () => setState(() {
                            if (!_countries.add(c.code)) {
                              _countries.remove(c.code);
                            }
                          }),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.xl),

              // Shared interests (premium). A switch row: only match peers who
              // share ≥1 interest. Free users see it locked (Premium badge).
              _InterestsToggle(
                value: premium && _sharedInterestsOnly,
                enabled: premium,
                onChanged: (v) => setState(() => _sharedInterestsOnly = v),
              ),
              const SizedBox(height: AppSpacing.xl),

              Row(
                children: [
                  TextButton(onPressed: _reset, child: const Text('Сбросить')),
                  const Spacer(),
                  Expanded(
                    child: GradientButton(
                      label: 'Применить',
                      onPressed: _apply,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The grabber pill at the top of the glass sheet — a soft gradient bar so it
/// reads as part of the neon liquid-glass language rather than a grey nub.
class _DragHandle extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      width: 44,
      height: 5,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            colors.neonViolet.withValues(alpha: 0.7),
            colors.neonMagenta.withValues(alpha: 0.7),
          ],
        ),
        borderRadius: AppRadii.brPill,
      ),
    );
  }
}

class _LabelRow extends StatelessWidget {
  const _LabelRow({required this.label, required this.showPremium});

  final String label;
  final bool showPremium;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(label, style: context.texts.titleSmall),
        if (showPremium) ...[
          const SizedBox(width: AppSpacing.sm),
          const UserBadgePill(badge: Badge.premium),
        ],
      ],
    );
  }
}

/// The "Только с общими интересами" switch row. Premium-gated: when [enabled]
/// is false the control is dimmed + inert and a Premium badge appears, mirroring
/// the gender/country gating above. A short caption explains the effect.
class _InterestsToggle extends StatelessWidget {
  const _InterestsToggle({
    required this.value,
    required this.enabled,
    required this.onChanged,
  });

  final bool value;
  final bool enabled;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;

    return Opacity(
      opacity: enabled ? 1 : 0.55,
      child: Container(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.md,
          AppSpacing.sm,
          AppSpacing.sm,
          AppSpacing.sm,
        ),
        decoration: BoxDecoration(
          borderRadius: AppRadii.brLg,
          color: scheme.surfaceContainerHighest.withValues(alpha: 0.35),
          border: Border.all(
            color: value && enabled
                ? colors.neonMagenta.withValues(alpha: 0.5)
                : colors.glassBorder,
          ),
        ),
        child: Row(
          children: [
            Icon(
              Icons.interests_rounded,
              size: 20,
              color: value && enabled
                  ? colors.neonMagenta
                  : scheme.onSurfaceVariant,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          'Только с общими интересами',
                          style: context.texts.titleSmall,
                        ),
                      ),
                      if (!enabled) ...[
                        const SizedBox(width: AppSpacing.sm),
                        const UserBadgePill(badge: Badge.premium),
                      ],
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Подбираем собеседников минимум с одним общим интересом.',
                    style: context.texts.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.xs),
            IgnorePointer(
              ignoring: !enabled,
              child: Switch(
                value: value,
                onChanged: enabled ? onChanged : null,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SegmentChip extends StatelessWidget {
  const _SegmentChip({
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
    return AnimatedContainer(
      duration: AppDurations.fast,
      curve: AppCurves.glass,
      decoration: BoxDecoration(
        borderRadius: AppRadii.brMd,
        boxShadow: selected
            ? AppShadows.glow(colors.neonMagenta, strength: 0.4)
            : null,
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: AppRadii.brMd,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          borderRadius: AppRadii.brMd,
          splashColor: colors.neonViolet.withValues(alpha: 0.14),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 12),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: AppRadii.brMd,
              gradient: selected
                  ? LinearGradient(colors: colors.ctaGradient)
                  : null,
              color: selected
                  ? null
                  : context.scheme.surfaceContainerHighest.withValues(
                      alpha: 0.4,
                    ),
              border: Border.all(
                color: selected ? Colors.transparent : colors.glassBorder,
              ),
            ),
            child: Text(
              label,
              style: context.texts.labelLarge?.copyWith(
                color: selected
                    ? Colors.white
                    : context.scheme.onSurfaceVariant,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CountryChip extends StatelessWidget {
  const _CountryChip({
    required this.code,
    required this.name,
    required this.selected,
    required this.onTap,
  });

  final String code;
  final String name;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadii.brPill,
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: AppSpacing.sm,
          ),
          decoration: BoxDecoration(
            borderRadius: AppRadii.brPill,
            color: selected
                ? colors.neonViolet.withValues(alpha: 0.18)
                : context.scheme.surfaceContainerHighest.withValues(alpha: 0.4),
            border: Border.all(
              color: selected
                  ? colors.neonViolet.withValues(alpha: 0.6)
                  : colors.glassBorder,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              CountryFlag(countryCode: code, size: 15),
              const SizedBox(width: 6),
              Text(
                name,
                style: context.texts.labelMedium?.copyWith(
                  color: selected
                      ? context.scheme.onSurface
                      : context.scheme.onSurfaceVariant,
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (selected) ...[
                const SizedBox(width: 4),
                Icon(Icons.check_rounded, size: 14, color: colors.neonViolet),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
