import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/api/api.dart';
import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../auth/domain/auth_options.dart' show Choice;
import '../../data/devices_provider.dart';
import '../../data/settings_controller.dart';
import '../settings_feedback.dart';
import '../widgets/settings_primitives.dart';

/// Devices section — preferred camera + microphone, backed by
/// `enumerateDevices`. Labels need a camera/mic permission grant, so when
/// they're hidden we show a "grant access" prompt. The chosen ids persist to
/// `settings.devices`.
class DevicesSection extends ConsumerStatefulWidget {
  const DevicesSection({super.key, required this.settings});

  final Settings settings;

  @override
  ConsumerState<DevicesSection> createState() => _DevicesSectionState();
}

class _DevicesSectionState extends ConsumerState<DevicesSection> {
  late DeviceSettings _draft = widget.settings.devices;
  bool _saving = false;

  @override
  void didUpdateWidget(DevicesSection old) {
    super.didUpdateWidget(old);
    if (old.settings.devices.preferredCameraId !=
            widget.settings.devices.preferredCameraId ||
        old.settings.devices.preferredMicId !=
            widget.settings.devices.preferredMicId) {
      _draft = widget.settings.devices;
    }
  }

  bool get _dirty {
    final d = widget.settings.devices;
    return _draft.preferredCameraId != d.preferredCameraId ||
        _draft.preferredMicId != d.preferredMicId;
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await ref
          .read(settingsControllerProvider.notifier)
          .patch(UpdateSettingsDto(devices: _draft));
      if (mounted) showSettingsSaved(context, 'Устройства сохранены');
    } on ApiException catch (e) {
      if (mounted) showSettingsError(context, e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final devicesAsync = ref.watch(devicesControllerProvider);
    final devices = devicesAsync.value;
    final showFooter = devices != null &&
        devices.supported &&
        !devices.labelsHidden &&
        (devices.cameras.isNotEmpty || devices.microphones.isNotEmpty);

    return SettingsSection(
      title: 'Камера и микрофон',
      description: 'Устройства по умолчанию для звонков.',
      icon: Icons.videocam_outlined,
      footer: showFooter
          ? SectionSaveBar(dirty: _dirty, saving: _saving, onSave: _save)
          : null,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
          child: devicesAsync.when(
            loading: () => const _DevicesLoading(),
            error: (_, _) => const _DevicesUnsupported(),
            data: (state) => _body(state),
          ),
        ),
      ],
    );
  }

  Widget _body(DevicesState state) {
    if (!state.supported) return const _DevicesUnsupported();
    if (state.labelsHidden) {
      return _DevicesPermissionPrompt(
        onGrant: () =>
            ref.read(devicesControllerProvider.notifier).requestPermission(),
      );
    }

    final cameraOptions = <Choice<String?>>[
      const Choice(null, 'По умолчанию'),
      for (final c in state.cameras)
        Choice(c.deviceId, c.hasLabel ? c.label : _fallbackLabel('Камера', c.deviceId)),
    ];
    final micOptions = <Choice<String?>>[
      const Choice(null, 'По умолчанию'),
      for (final m in state.microphones)
        Choice(m.deviceId, m.hasLabel ? m.label : _fallbackLabel('Микрофон', m.deviceId)),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SettingRow(
          label: 'Камера',
          description: 'Найдено: ${state.cameras.length}',
          stacked: true,
          control: SettingsSelect<String?>(
            value: _validValue(_draft.preferredCameraId, cameraOptions),
            options: cameraOptions,
            onChanged: (v) =>
                setState(() => _draft = DeviceSettings(
                      preferredCameraId: v,
                      preferredMicId: _draft.preferredMicId,
                    )),
          ),
        ),
        const SettingRowDivider(),
        SettingRow(
          label: 'Микрофон',
          description: 'Найдено: ${state.microphones.length}',
          stacked: true,
          control: SettingsSelect<String?>(
            value: _validValue(_draft.preferredMicId, micOptions),
            options: micOptions,
            onChanged: (v) =>
                setState(() => _draft = DeviceSettings(
                      preferredCameraId: _draft.preferredCameraId,
                      preferredMicId: v,
                    )),
          ),
        ),
      ],
    );
  }

  /// Guard against a saved id that's no longer present (unplugged device) so
  /// the dropdown always has a matching item — fall back to "default" (null).
  String? _validValue(String? saved, List<Choice<String?>> options) {
    if (saved == null) return null;
    final exists = options.any((o) => o.value == saved);
    return exists ? saved : null;
  }

  String _fallbackLabel(String kind, String id) =>
      '$kind ${id.length > 6 ? id.substring(0, 6) : id}';
}

class _DevicesLoading extends StatelessWidget {
  const _DevicesLoading();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
      child: Center(child: CircularProgressIndicator(strokeWidth: 2.4)),
    );
  }
}

class _DevicesUnsupported extends StatelessWidget {
  const _DevicesUnsupported();

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
      child: Column(
        children: [
          Icon(Icons.videocam_off_outlined,
              size: 32, color: context.colors.warning),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Не удалось получить список устройств на этом устройстве.',
            textAlign: TextAlign.center,
            style: context.texts.bodySmall
                ?.copyWith(color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _DevicesPermissionPrompt extends StatelessWidget {
  const _DevicesPermissionPrompt({required this.onGrant});

  final VoidCallback onGrant;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        borderRadius: AppRadii.brMd,
        border: Border.all(color: colors.glassBorder),
      ),
      child: Column(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: colors.neonViolet.withValues(alpha: 0.12),
            ),
            child: Icon(Icons.perm_camera_mic_outlined,
                color: colors.neonViolet),
          ),
          const SizedBox(height: AppSpacing.md),
          Text('Разрешите доступ к камере и микрофону',
              textAlign: TextAlign.center, style: context.texts.titleSmall),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Нужно, чтобы показать названия ваших устройств.',
            textAlign: TextAlign.center,
            style: context.texts.bodySmall
                ?.copyWith(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: AppSpacing.md),
          OutlinedButton.icon(
            onPressed: onGrant,
            icon: const Icon(Icons.lock_open_rounded, size: 18),
            label: const Text('Разрешить доступ'),
          ),
        ],
      ),
    );
  }
}
