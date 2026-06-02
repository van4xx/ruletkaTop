import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/api/api.dart';
import '../../../../core/di/di.dart';
import '../../../../core/theme/theme.dart';
import '../settings_feedback.dart';
import '../widgets/settings_primitives.dart';

/// Danger zone — logout and irreversible account deletion.
///
/// Logout clears the in-memory access token + secure-storage refresh token and
/// tears the socket down (via [AuthController.logout]); the router guard then
/// bounces to /login. Deletion is gated behind a typed-nickname confirmation
/// dialog and calls `DELETE /users/me`, then logs out.
class DangerSection extends ConsumerStatefulWidget {
  const DangerSection({super.key});

  @override
  ConsumerState<DangerSection> createState() => _DangerSectionState();
}

class _DangerSectionState extends ConsumerState<DangerSection> {
  bool _loggingOut = false;

  Future<void> _logout() async {
    setState(() => _loggingOut = true);
    await ref.read(authControllerProvider.notifier).logout();
    // The guard redirects to /login on the auth-status change; nothing else
    // to do. (No setState after — this widget unmounts with the route.)
  }

  Future<void> _confirmDelete() async {
    final nickname = ref.read(currentUserProvider)?.nickname ?? '';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => _DeleteAccountDialog(nickname: nickname),
    );
    if (confirmed != true || !mounted) return;

    try {
      await ref.read(apiClientProvider).deleteAccount();
      // Tear down the session locally + disconnect the socket.
      await ref.read(authControllerProvider.notifier).logout();
      // Guard handles the redirect to /login.
    } on ApiException catch (e) {
      if (mounted) showSettingsError(context, e.message);
    } catch (_) {
      if (mounted) showSettingsError(context, 'Не удалось удалить аккаунт.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;

    return SettingsSection(
      title: 'Опасная зона',
      description: 'Необратимые действия с аккаунтом.',
      icon: Icons.warning_amber_rounded,
      danger: true,
      children: [
        SettingRow(
          label: 'Выйти из аккаунта',
          description: 'Завершить сеанс на этом устройстве.',
          control: OutlinedButton.icon(
            onPressed: _loggingOut ? null : _logout,
            icon: _loggingOut
                ? const SizedBox(
                    height: 16,
                    width: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.logout_rounded, size: 18),
            label: const Text('Выйти'),
          ),
        ),
        const SettingRowDivider(),
        SettingRow(
          label: 'Удалить аккаунт',
          description: 'Профиль, переписки, монеты — безвозвратно.',
          stacked: true,
          control: Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.icon(
              onPressed: _confirmDelete,
              style: FilledButton.styleFrom(
                backgroundColor: scheme.error,
                foregroundColor: scheme.onError,
              ),
              icon: const Icon(Icons.delete_forever_rounded, size: 18),
              label: const Text('Удалить аккаунт'),
            ),
          ),
        ),
      ],
    );
  }
}

/// Typed-confirmation dialog: the user must type their nickname to enable the
/// destructive action (a deliberate friction gate, matching the web).
class _DeleteAccountDialog extends StatefulWidget {
  const _DeleteAccountDialog({required this.nickname});

  final String nickname;

  @override
  State<_DeleteAccountDialog> createState() => _DeleteAccountDialogState();
}

class _DeleteAccountDialogState extends State<_DeleteAccountDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  bool get _canDelete =>
      widget.nickname.isNotEmpty &&
      _controller.text.trim() == widget.nickname;

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;

    return AlertDialog(
      title: const Text('Удалить аккаунт навсегда?'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text.rich(
            TextSpan(
              style: context.texts.bodyMedium
                  ?.copyWith(color: scheme.onSurfaceVariant),
              children: [
                const TextSpan(
                    text: 'Это действие необратимо. Чтобы подтвердить, '
                        'введите свой никнейм '),
                TextSpan(
                  text: widget.nickname,
                  style: TextStyle(
                    color: scheme.onSurface,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const TextSpan(text: '.'),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          TextField(
            controller: _controller,
            autofocus: true,
            autocorrect: false,
            enableSuggestions: false,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: 'Никнейм',
              hintText: widget.nickname,
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Отмена'),
        ),
        FilledButton(
          onPressed:
              _canDelete ? () => Navigator.of(context).pop(true) : null,
          style: FilledButton.styleFrom(
            backgroundColor: scheme.error,
            foregroundColor: scheme.onError,
          ),
          child: const Text('Удалить навсегда'),
        ),
      ],
    );
  }
}
