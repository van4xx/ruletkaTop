import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/models/models.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../data/settings_controller.dart';
import 'sections/account_section.dart';
import 'sections/appearance_section.dart';
import 'sections/blocklist_section.dart';
import 'sections/danger_section.dart';
import 'sections/devices_section.dart';
import 'sections/notifications_section.dart';
import 'sections/privacy_section.dart';
import 'sections/sessions_section.dart';

/// `/settings` — the account control center. A single scrollable column that
/// stacks every settings section (each a self-contained titled glass card) in a
/// clean grouped layout, mirroring the web's settings tabs but flattened for
/// mobile.
///
/// The settings *document* (`GET /settings`) backs the Appearance,
/// Notifications, Privacy and Devices sections, so those render inside the
/// document's [AsyncValue]: a shimmer while loading and an [ErrorView] (with a
/// retry that calls [SettingsController.reload]) on failure. The Account,
/// Blocklist and Danger sections own their own data and are always shown.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settingsAsync = ref.watch(settingsControllerProvider);

    return AppScaffold(
      title: 'Настройки',
      showBottomNav: false,
      currentRoute: null,
      body: RefreshIndicator(
        onRefresh: () => ref.read(settingsControllerProvider.notifier).reload(),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xxxl),
          children: [
            // ── Profile & identity ──
            const _GroupLabel(
              icon: Icons.account_circle_outlined,
              label: 'Профиль',
            ),
            const SizedBox(height: AppSpacing.sm),
            const AccountSection(),
            const SizedBox(height: AppSpacing.xl),

            // ── Preferences (backed by the settings document) ──
            const _GroupLabel(
              icon: Icons.tune_rounded,
              label: 'Предпочтения',
            ),
            const SizedBox(height: AppSpacing.sm),
            settingsAsync.when(
              loading: () => const _PreferencesSkeleton(),
              error: (err, _) => _PreferencesError(
                message: err is ApiException
                    ? err.message
                    : 'Не удалось загрузить настройки.',
                onRetry: () =>
                    ref.read(settingsControllerProvider.notifier).reload(),
              ),
              data: (settings) => _PreferencesGroup(settings: settings),
            ),
            const SizedBox(height: AppSpacing.xl),

            // ── Safety ──
            const _GroupLabel(
              icon: Icons.shield_moon_outlined,
              label: 'Безопасность',
            ),
            const SizedBox(height: AppSpacing.sm),
            const BlocklistSection(),
            const SizedBox(height: AppSpacing.xl),

            // ── Danger zone ──
            const DangerSection(),
          ],
        ),
      ),
    );
  }
}

/// The four sections that need the loaded [Settings] document, stacked with
/// consistent spacing.
class _PreferencesGroup extends StatelessWidget {
  const _PreferencesGroup({required this.settings});

  final Settings settings;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AppearanceSection(settings: settings),
        const SizedBox(height: AppSpacing.lg),
        NotificationsSection(settings: settings),
        const SizedBox(height: AppSpacing.lg),
        PrivacySection(settings: settings),
        const SizedBox(height: AppSpacing.lg),
        DevicesSection(settings: settings),
        const SizedBox(height: AppSpacing.lg),
        const SessionsSection(),
      ],
    );
  }
}

/// A small uppercase group heading with a leading icon, used to chunk the
/// settings into scannable bands.
class _GroupLabel extends StatelessWidget {
  const _GroupLabel({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Padding(
      padding: const EdgeInsets.only(left: AppSpacing.xs),
      child: Row(
        children: [
          Icon(icon, size: 16, color: colors.neonViolet),
          const SizedBox(width: AppSpacing.sm),
          Text(
            label.toUpperCase(),
            style: context.texts.labelSmall?.copyWith(
              color: colors.neonViolet,
              letterSpacing: 1.2,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

/// Placeholder cards while the settings document loads, sized to roughly match
/// the preference sections so the layout doesn't jump.
class _PreferencesSkeleton extends StatelessWidget {
  const _PreferencesSkeleton();

  @override
  Widget build(BuildContext context) {
    return LoadingShimmer(
      child: Column(
        children: [
          for (var i = 0; i < 4; i++) ...[
            if (i > 0) const SizedBox(height: AppSpacing.lg),
            Container(
              height: 168,
              decoration: BoxDecoration(
                color: context.scheme.surfaceContainerHighest,
                borderRadius: AppRadii.brXl,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// A compact, glassy error band for a failed settings-document load, with a
/// retry. Sits in place of the preference sections (the rest of the page stays
/// usable).
class _PreferencesError extends StatelessWidget {
  const _PreferencesError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    return GlassCard(
      child: Column(
        children: [
          Icon(Icons.cloud_off_rounded, size: 36, color: scheme.error),
          const SizedBox(height: AppSpacing.sm),
          Text('Настройки недоступны', style: context.texts.titleSmall),
          const SizedBox(height: 2),
          Text(
            message,
            textAlign: TextAlign.center,
            style: context.texts.bodySmall
                ?.copyWith(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: AppSpacing.md),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded, size: 18),
            label: const Text('Повторить'),
          ),
        ],
      ),
    );
  }
}
