import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/api/api.dart';
import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../auth/domain/auth_options.dart';
import '../../../auth/presentation/widgets/auth_form_fields.dart';
import '../../domain/settings_options.dart';
import '../../data/settings_controller.dart';
import '../settings_feedback.dart';
import '../widgets/settings_primitives.dart';

/// Appearance section — color theme (light / dark / system) and interface
/// locale. Theme applies on tap (instant PATCH); locale has a save button.
///
/// NOTE: `main.dart` (foundation-owned) currently pins `ThemeMode.dark`. This
/// section always persists the choice to the server so it syncs across devices;
/// once the integrator wires [themeModeProvider] / [preferredLocaleProvider]
/// into `MaterialApp.router`, the change also takes effect live in-app.
class AppearanceSection extends ConsumerStatefulWidget {
  const AppearanceSection({super.key, required this.settings});

  final Settings settings;

  @override
  ConsumerState<AppearanceSection> createState() => _AppearanceSectionState();
}

class _AppearanceSectionState extends ConsumerState<AppearanceSection> {
  late Locale _localeDraft = widget.settings.locale;
  bool _savingLocale = false;

  @override
  void didUpdateWidget(AppearanceSection old) {
    super.didUpdateWidget(old);
    if (old.settings.locale != widget.settings.locale) {
      _localeDraft = widget.settings.locale;
    }
  }

  Future<void> _chooseTheme(AppThemeMode mode) async {
    if (mode == widget.settings.theme) return;
    try {
      await ref
          .read(settingsControllerProvider.notifier)
          .patch(UpdateSettingsDto(theme: mode));
    } on ApiException catch (e) {
      if (mounted) showSettingsError(context, e.message);
    }
  }

  Future<void> _saveLocale() async {
    setState(() => _savingLocale = true);
    try {
      await ref
          .read(settingsControllerProvider.notifier)
          .patch(UpdateSettingsDto(locale: _localeDraft));
      if (mounted) showSettingsSaved(context, 'Язык сохранён');
    } on ApiException catch (e) {
      if (mounted) showSettingsError(context, e.message);
    } finally {
      if (mounted) setState(() => _savingLocale = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final current = widget.settings.theme;
    final localeDirty = _localeDraft != widget.settings.locale;

    return SettingsSection(
      title: 'Оформление',
      description: 'Тема и язык интерфейса.',
      icon: Icons.palette_outlined,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Тема', style: context.texts.bodyMedium),
              const SizedBox(height: AppSpacing.sm),
              Row(
                children: [
                  for (final choice in kThemeChoices) ...[
                    if (choice != kThemeChoices.first)
                      const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: _ThemeCard(
                        mode: choice.value,
                        label: choice.label,
                        selected: current == choice.value,
                        onTap: () => _chooseTheme(choice.value),
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
        const SettingRowDivider(),
        SettingRow(
          label: 'Язык интерфейса',
          description: 'Применяется при следующем запуске.',
          stacked: true,
          control: Row(
            children: [
              Expanded(
                child: SegmentedChoice<Locale>(
                  options: kLocaleChoices,
                  value: _localeDraft,
                  onChanged: (l) => setState(() => _localeDraft = l),
                ),
              ),
              if (localeDirty) ...[
                const SizedBox(width: AppSpacing.md),
                SectionSaveBar(
                  dirty: true,
                  saving: _savingLocale,
                  onSave: _saveLocale,
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// A selectable theme preview card (gradient swatch + icon + label).
class _ThemeCard extends StatelessWidget {
  const _ThemeCard({
    required this.mode,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final AppThemeMode mode;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;

    final (icon, swatch) = switch (mode) {
      AppThemeMode.light => (
          Icons.light_mode_rounded,
          const [Color(0xFFEFEFF4), Color(0xFFFFFFFF)],
        ),
      AppThemeMode.dark => (
          Icons.dark_mode_rounded,
          const [Color(0xFF0B0C16), Color(0xFF1C1B29)],
        ),
      AppThemeMode.system => (
          Icons.brightness_auto_rounded,
          const [Color(0xFFEFEFF4), Color(0xFF0B0C16)],
        ),
    };

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: AppRadii.brMd,
        onTap: onTap,
        child: AnimatedContainer(
          duration: AppDurations.fast,
          padding: const EdgeInsets.all(AppSpacing.sm),
          decoration: BoxDecoration(
            borderRadius: AppRadii.brMd,
            border: Border.all(
              color: selected ? colors.neonViolet : colors.glassBorder,
              width: selected ? 2 : 1,
            ),
            boxShadow:
                selected ? AppShadows.glow(colors.neonViolet, strength: 0.3) : null,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                height: 40,
                decoration: BoxDecoration(
                  borderRadius: AppRadii.brSm,
                  gradient: LinearGradient(
                    colors: swatch,
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    icon,
                    size: 15,
                    color: selected ? colors.neonViolet : scheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 4),
                  Flexible(
                    child: Text(
                      label,
                      overflow: TextOverflow.ellipsis,
                      style: context.texts.labelSmall?.copyWith(
                        color: selected ? scheme.onSurface : scheme.onSurfaceVariant,
                        fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
                      ),
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
