import 'package:flutter/material.dart' hide Visibility;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/api/api.dart';
import '../../../../core/models/models.dart';
import '../../data/settings_controller.dart';
import '../../domain/settings_options.dart';
import '../settings_feedback.dart';
import '../widgets/settings_primitives.dart';

/// Privacy section — who can message / call / view the profile, plus the
/// online-status toggle. Edits a local draft of `settings.privacy` and PATCHes
/// the diff; the save button enables only when the draft differs.
class PrivacySection extends ConsumerStatefulWidget {
  const PrivacySection({super.key, required this.settings});

  final Settings settings;

  @override
  ConsumerState<PrivacySection> createState() => _PrivacySectionState();
}

class _PrivacySectionState extends ConsumerState<PrivacySection> {
  late PrivacySettings _draft = widget.settings.privacy;
  bool _saving = false;

  @override
  void didUpdateWidget(PrivacySection old) {
    super.didUpdateWidget(old);
    // Re-sync when the server value changes (e.g. after a successful save).
    if (old.settings.privacy != widget.settings.privacy) {
      _draft = widget.settings.privacy;
    }
  }

  bool get _dirty {
    final p = widget.settings.privacy;
    return _draft.whoCanMessage != p.whoCanMessage ||
        _draft.whoCanCall != p.whoCanCall ||
        _draft.whoCanViewProfile != p.whoCanViewProfile ||
        _draft.showOnlineStatus != p.showOnlineStatus;
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await ref
          .read(settingsControllerProvider.notifier)
          .patch(UpdateSettingsDto(privacy: _draft));
      if (mounted) showSettingsSaved(context, 'Настройки приватности сохранены');
    } on ApiException catch (e) {
      if (mounted) showSettingsError(context, e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsSection(
      title: 'Приватность',
      description: 'Кто может связаться с вами и видеть профиль.',
      icon: Icons.shield_outlined,
      footer: SectionSaveBar(dirty: _dirty, saving: _saving, onSave: _save),
      children: [
        SettingRow(
          label: 'Кто может писать',
          description: 'Сообщения от остальных будут скрыты.',
          control: SettingsSelect<Visibility>(
            value: _draft.whoCanMessage,
            options: kVisibilityChoices,
            onChanged: (v) =>
                setState(() => _draft = _draft.copyWith(whoCanMessage: v)),
          ),
        ),
        const SettingRowDivider(),
        SettingRow(
          label: 'Кто может звонить',
          description: 'Входящие звонки от остальных отклоняются.',
          control: SettingsSelect<Visibility>(
            value: _draft.whoCanCall,
            options: kVisibilityChoices,
            onChanged: (v) =>
                setState(() => _draft = _draft.copyWith(whoCanCall: v)),
          ),
        ),
        const SettingRowDivider(),
        SettingRow(
          label: 'Кто видит профиль',
          control: SettingsSelect<Visibility>(
            value: _draft.whoCanViewProfile,
            options: kVisibilityChoices,
            onChanged: (v) =>
                setState(() => _draft = _draft.copyWith(whoCanViewProfile: v)),
          ),
        ),
        const SettingRowDivider(),
        SettingRow(
          label: 'Показывать статус «в сети»',
          description: 'Другие видят, когда вы онлайн.',
          control: Switch(
            value: _draft.showOnlineStatus,
            onChanged: (v) =>
                setState(() => _draft = _draft.copyWith(showOnlineStatus: v)),
          ),
        ),
      ],
    );
  }
}
