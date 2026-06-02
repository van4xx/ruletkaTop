import 'package:flutter/material.dart';

import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../../../auth/domain/auth_options.dart' show Choice;

/// A titled settings section: a glass card with an iconed header, body content
/// and an optional footer (typically a save button). The mobile analogue of the
/// web's `SettingsSection`.
class SettingsSection extends StatelessWidget {
  const SettingsSection({
    super.key,
    required this.title,
    required this.icon,
    required this.children,
    this.description,
    this.footer,
    this.accent,
    this.danger = false,
  });

  final String title;
  final IconData icon;
  final String? description;
  final List<Widget> children;
  final Widget? footer;
  final Color? accent;

  /// Tints the section as a destructive zone (the Danger section).
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;
    final tint = danger ? scheme.error : (accent ?? colors.neonViolet);

    return GlassCard(
      padding: EdgeInsets.zero,
      border: true,
      blurSigma: 12,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header
          Padding(
            padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.md),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: tint.withValues(alpha: 0.12),
                    borderRadius: AppRadii.brMd,
                    border: Border.all(color: tint.withValues(alpha: 0.35)),
                  ),
                  child: Icon(icon, size: 19, color: tint),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: context.texts.titleMedium),
                      if (description != null) ...[
                        const SizedBox(height: 2),
                        Text(
                          description!,
                          style: context.texts.bodySmall
                              ?.copyWith(color: scheme.onSurfaceVariant),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
          Divider(height: 1, color: colors.glassBorder),
          // Body
          Padding(
            padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: children,
            ),
          ),
          if (footer != null) ...[
            Divider(height: 1, color: colors.glassBorder),
            Padding(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Align(alignment: Alignment.centerRight, child: footer),
            ),
          ],
        ],
      ),
    );
  }
}

/// A labelled row inside a [SettingsSection]: a label (+ optional description)
/// on the left and a [control] on the right. On narrow widths the control wraps
/// below for breathing room. Dividers between consecutive rows are drawn by the
/// caller via [SettingRow.divided].
class SettingRow extends StatelessWidget {
  const SettingRow({
    super.key,
    required this.label,
    required this.control,
    this.description,
    this.stacked = false,
  });

  final String label;
  final Widget control;
  final String? description;

  /// Force the control onto its own full-width line below the label.
  final bool stacked;

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    final labelBlock = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(label, style: context.texts.bodyMedium),
        if (description != null) ...[
          const SizedBox(height: 2),
          Text(
            description!,
            style: context.texts.bodySmall
                ?.copyWith(color: scheme.onSurfaceVariant),
          ),
        ],
      ],
    );

    if (stacked) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            labelBlock,
            const SizedBox(height: AppSpacing.sm),
            control,
          ],
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(child: labelBlock),
          const SizedBox(width: AppSpacing.md),
          control,
        ],
      ),
    );
  }
}

/// A divider between rows within a section (hairline, inset to the body).
class SettingRowDivider extends StatelessWidget {
  const SettingRowDivider({super.key});

  @override
  Widget build(BuildContext context) =>
      Divider(height: 1, color: context.colors.glassBorder);
}

/// A compact, themed dropdown for enum-backed settings (visibility, etc.).
/// Wraps [DropdownButton] in the app's input styling. Generic over [T].
class SettingsSelect<T> extends StatelessWidget {
  const SettingsSelect({
    super.key,
    required this.value,
    required this.options,
    required this.onChanged,
  });

  final T value;
  final List<Choice<T>> options;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.4),
        borderRadius: AppRadii.brMd,
        border: Border.all(color: colors.glassBorder),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<T>(
          value: value,
          isDense: true,
          borderRadius: AppRadii.brMd,
          dropdownColor: scheme.surfaceContainerHigh,
          icon: const Icon(Icons.expand_more_rounded),
          style: context.texts.bodyMedium?.copyWith(color: scheme.onSurface),
          items: [
            for (final o in options)
              DropdownMenuItem<T>(value: o.value, child: Text(o.label)),
          ],
          onChanged: (v) {
            if (v != null) onChanged(v);
          },
        ),
      ),
    );
  }
}

/// A small trailing "save" affordance for sections with a dirty draft. Shows an
/// "unsaved changes" hint to the left of the button when [dirty].
class SectionSaveBar extends StatelessWidget {
  const SectionSaveBar({
    super.key,
    required this.dirty,
    required this.saving,
    required this.onSave,
    this.label = 'Сохранить',
  });

  final bool dirty;
  final bool saving;
  final VoidCallback onSave;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (dirty)
          Padding(
            padding: const EdgeInsets.only(right: AppSpacing.md),
            child: Text(
              'Есть изменения',
              style: context.texts.bodySmall
                  ?.copyWith(color: context.scheme.onSurfaceVariant),
            ),
          ),
        GradientButton(
          label: label,
          fullWidth: false,
          height: 44,
          loading: saving,
          onPressed: dirty && !saving ? onSave : null,
        ),
      ],
    );
  }
}
