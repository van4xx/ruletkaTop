import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/api/api.dart';
import '../../../../core/models/models.dart';
import '../../data/settings_controller.dart';
import '../settings_feedback.dart';
import '../widgets/settings_primitives.dart';

/// Notifications section — delivery channels (push / email) and per-event
/// toggles (friend requests, messages, gifts). Edits a local draft of
/// `settings.notifications` and PATCHes the diff.
class NotificationsSection extends ConsumerStatefulWidget {
  const NotificationsSection({super.key, required this.settings});

  final Settings settings;

  @override
  ConsumerState<NotificationsSection> createState() =>
      _NotificationsSectionState();
}

class _NotificationsSectionState extends ConsumerState<NotificationsSection> {
  late NotificationSettings _draft = widget.settings.notifications;
  bool _saving = false;

  @override
  void didUpdateWidget(NotificationsSection old) {
    super.didUpdateWidget(old);
    if (old.settings.notifications != widget.settings.notifications) {
      _draft = widget.settings.notifications;
    }
  }

  bool get _dirty {
    final n = widget.settings.notifications;
    return _draft.pushEnabled != n.pushEnabled ||
        _draft.emailEnabled != n.emailEnabled ||
        _draft.friendRequests != n.friendRequests ||
        _draft.messages != n.messages ||
        _draft.gifts != n.gifts;
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await ref
          .read(settingsControllerProvider.notifier)
          .patch(UpdateSettingsDto(notifications: _draft));
      if (mounted) showSettingsSaved(context, 'Уведомления сохранены');
    } on ApiException catch (e) {
      if (mounted) showSettingsError(context, e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsSection(
      title: 'Уведомления',
      description: 'Каналы доставки и события, о которых хотите знать.',
      icon: Icons.notifications_none_rounded,
      footer: SectionSaveBar(dirty: _dirty, saving: _saving, onSave: _save),
      children: [
        _Toggle(
          label: 'Push-уведомления',
          description: 'В мобильном приложении.',
          value: _draft.pushEnabled,
          onChanged: (v) => setState(() => _draft = _draft.copyWith(pushEnabled: v)),
        ),
        const SettingRowDivider(),
        _Toggle(
          label: 'Email-уведомления',
          description: 'Сводки и важные события на почту.',
          value: _draft.emailEnabled,
          onChanged: (v) =>
              setState(() => _draft = _draft.copyWith(emailEnabled: v)),
        ),
        const SettingRowDivider(),
        _Toggle(
          label: 'Заявки в друзья',
          value: _draft.friendRequests,
          onChanged: (v) =>
              setState(() => _draft = _draft.copyWith(friendRequests: v)),
        ),
        const SettingRowDivider(),
        _Toggle(
          label: 'Сообщения',
          value: _draft.messages,
          onChanged: (v) => setState(() => _draft = _draft.copyWith(messages: v)),
        ),
        const SettingRowDivider(),
        _Toggle(
          label: 'Подарки',
          value: _draft.gifts,
          onChanged: (v) => setState(() => _draft = _draft.copyWith(gifts: v)),
        ),
      ],
    );
  }
}

class _Toggle extends StatelessWidget {
  const _Toggle({
    required this.label,
    required this.value,
    required this.onChanged,
    this.description,
  });

  final String label;
  final String? description;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return SettingRow(
      label: label,
      description: description,
      control: Switch(value: value, onChanged: onChanged),
    );
  }
}
