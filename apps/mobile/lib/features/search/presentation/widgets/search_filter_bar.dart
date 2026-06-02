import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../../domain/search_controller.dart';
import 'country_picker_sheet.dart';

/// The discovery controls for `/search`: a query field (writes through to
/// [searchFiltersProvider], the results notifier debounces it), a gender
/// segmented control, a country chip (opens [CountryPickerSheet]) and an
/// "online only" toggle. Purely a view over the filters notifier.
class SearchFilterBar extends ConsumerStatefulWidget {
  const SearchFilterBar({super.key});

  @override
  ConsumerState<SearchFilterBar> createState() => _SearchFilterBarState();
}

class _SearchFilterBarState extends ConsumerState<SearchFilterBar> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: ref.read(searchFiltersProvider).q);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final filters = ref.watch(searchFiltersProvider);
    final notifier = ref.read(searchFiltersProvider.notifier);

    // Keep the field in sync if the query is changed elsewhere (e.g. the empty
    // state's "Сбросить" action). Done via `listen` so the controller is never
    // mutated synchronously during build.
    ref.listen<SearchFilters>(searchFiltersProvider, (prev, next) {
      if (_controller.text != next.q) {
        _controller.value = TextEditingValue(
          text: next.q,
          selection: TextSelection.collapsed(offset: next.q.length),
        );
      }
    });

    return GlassCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _controller,
            onChanged: notifier.setQuery,
            textInputAction: TextInputAction.search,
            autocorrect: false,
            decoration: InputDecoration(
              hintText: 'Имя пользователя…',
              prefixIcon: const Icon(Icons.search_rounded),
              suffixIcon: filters.q.isNotEmpty
                  ? IconButton(
                      tooltip: 'Очистить',
                      icon: const Icon(Icons.close_rounded),
                      onPressed: () {
                        _controller.clear();
                        notifier.clearQuery();
                      },
                    )
                  : null,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          // Gender segmented control.
          _GenderSelector(
            value: filters.gender,
            onChanged: notifier.setGender,
          ),
          const SizedBox(height: AppSpacing.sm),
          // Country + online row.
          Row(
            children: [
              Expanded(
                child: _FilterChip(
                  icon: Icons.public_rounded,
                  label: filters.country == null
                      ? 'Любая страна'
                      : '${CountryPickerSheet.flagOf(filters.country!)}  '
                          '${CountryPickerSheet.nameOf(filters.country!)}',
                  selected: filters.country != null,
                  onTap: () async {
                    final picked = await CountryPickerSheet.show(
                      context,
                      selected: filters.country,
                    );
                    // null result = dismissed; sentinel '' = explicit "any".
                    if (picked == null) return;
                    notifier.setCountry(picked.isEmpty ? null : picked);
                  },
                  onClear: filters.country != null
                      ? () => notifier.setCountry(null)
                      : null,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              _FilterChip(
                icon: Icons.bolt_rounded,
                label: 'Онлайн',
                selected: filters.onlineOnly,
                accent: colors.success,
                onTap: notifier.toggleOnline,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A four-way gender segmented control (Все / Женский / Мужской / Другое).
class _GenderSelector extends StatelessWidget {
  const _GenderSelector({required this.value, required this.onChanged});

  final Gender? value;
  final ValueChanged<Gender?> onChanged;

  static const _options = <(Gender?, String)>[
    (null, 'Все'),
    (Gender.female, 'Женский'),
    (Gender.male, 'Мужской'),
    (Gender.other, 'Другое'),
  ];

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: context.scheme.surface.withValues(alpha: 0.35),
        borderRadius: AppRadii.brMd,
        border: Border.all(color: colors.glassBorder),
      ),
      child: Padding(
        padding: const EdgeInsets.all(3),
        child: Row(
          children: [
            for (final (g, label) in _options)
              Expanded(
                child: _SegmentButton(
                  label: label,
                  selected: value == g,
                  onTap: () => onChanged(g),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _SegmentButton extends StatelessWidget {
  const _SegmentButton({
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
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: AppRadii.brSm,
        onTap: onTap,
        child: AnimatedContainer(
          duration: AppDurations.fast,
          height: 34,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: AppRadii.brSm,
            gradient: selected
                ? LinearGradient(colors: colors.ctaGradient)
                : null,
          ),
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: context.texts.labelMedium?.copyWith(
              color: selected ? Colors.white : context.scheme.onSurfaceVariant,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            ),
          ),
        ),
      ),
    );
  }
}

/// A pill-style toggle/selector chip used for the country + online filters.
class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
    this.accent,
    this.onClear,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final Color? accent;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final tint = accent ?? colors.neonViolet;
    final fg = selected ? tint : context.scheme.onSurfaceVariant;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: AppRadii.brPill,
        onTap: onTap,
        child: Container(
          height: 38,
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
          decoration: BoxDecoration(
            color: selected ? tint.withValues(alpha: 0.14) : Colors.transparent,
            borderRadius: AppRadii.brPill,
            border: Border.all(
              color: selected ? tint.withValues(alpha: 0.5) : colors.glassBorder,
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 16, color: fg),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.texts.labelMedium?.copyWith(
                    color: fg,
                    fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  ),
                ),
              ),
              if (onClear != null) ...[
                const SizedBox(width: 4),
                GestureDetector(
                  onTap: onClear,
                  behavior: HitTestBehavior.opaque,
                  child: Icon(Icons.close_rounded, size: 15, color: fg),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
