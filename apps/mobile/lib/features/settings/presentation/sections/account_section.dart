import 'package:flutter/material.dart' hide Badge;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/api/api.dart';
import '../../../../core/di/di.dart';
import '../../../../core/models/models.dart';
import '../../../../core/router/routes.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../../../auth/domain/auth_validators.dart';
import '../../../profile/presentation/profile_providers.dart';
import '../settings_feedback.dart';
import '../widgets/settings_primitives.dart';

/// Account section — the caller's identity (avatar, nickname, premium badge),
/// the read-only login email, a shortcut to the full profile editor and the
/// "Сменить пароль" action. Email is immutable here (matches the web: changing
/// it goes through support).
class AccountSection extends ConsumerWidget {
  const AccountSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final scheme = context.scheme;
    // The session user has no avatar URL; the own-profile detail does. Read it
    // (best-effort) so the row shows the real avatar instead of just initials.
    final avatarUrl = ref.watch(myProfileDetailProvider).value?.avatarUrl;

    return SettingsSection(
      title: 'Аккаунт',
      description: 'Данные вашей учётной записи.',
      icon: Icons.person_outline_rounded,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
          child: Row(
            children: [
              NeonAvatar(
                imageUrl: avatarUrl,
                name: user?.nickname,
                size: 56,
                ring: user?.isPremium ?? false,
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            user?.nickname ?? '—',
                            overflow: TextOverflow.ellipsis,
                            style: context.texts.titleMedium,
                          ),
                        ),
                        if (user?.isPremium ?? false) ...[
                          const SizedBox(width: AppSpacing.sm),
                          const UserBadgePill(badge: Badge.premium),
                        ],
                        if (user?.role.isStaff ?? false) ...[
                          const SizedBox(width: AppSpacing.sm),
                          const UserBadgePill(badge: Badge.staff),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      user?.email ?? '',
                      style: context.texts.bodySmall
                          ?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SettingRowDivider(),
        SettingRow(
          label: 'Редактировать профиль',
          description: 'Аватар, никнейм, о себе.',
          control: IconButton(
            onPressed: () => context.go(AppRoutes.me),
            icon: const Icon(Icons.chevron_right_rounded),
            tooltip: 'Открыть профиль',
          ),
        ),
        const SettingRowDivider(),
        SettingRow(
          label: 'Email',
          description: 'Для входа. Чтобы изменить — напишите в поддержку.',
          control: Icon(Icons.lock_outline_rounded,
              size: 18, color: scheme.onSurfaceVariant),
        ),
        const SettingRowDivider(),
        SettingRow(
          label: 'Сменить пароль',
          description: 'После смены потребуется войти заново.',
          control: OutlinedButton.icon(
            onPressed: () => _openChangePassword(context, ref),
            icon: const Icon(Icons.key_rounded, size: 18),
            label: const Text('Сменить'),
          ),
        ),
      ],
    );
  }

  /// Opens the change-password dialog, then performs the change. On success the
  /// server revokes ALL sessions, so we log out locally and let the router guard
  /// bounce to /login (the user re-authenticates with the new password).
  Future<void> _openChangePassword(BuildContext context, WidgetRef ref) async {
    final result = await showDialog<_ChangePasswordResult>(
      context: context,
      builder: (_) => const _ChangePasswordDialog(),
    );
    if (result == null || !context.mounted) return;

    try {
      await ref.read(apiClientProvider).changePassword(
            ChangePasswordDto(
              currentPassword: result.currentPassword,
              newPassword: result.newPassword,
            ),
          );
      if (context.mounted) {
        showSettingsSaved(context, 'Пароль изменён. Войдите заново.');
      }
      // All sessions are revoked server-side — tear down locally + redirect.
      await ref.read(authControllerProvider.notifier).logout();
    } on ApiException catch (e) {
      if (context.mounted) showSettingsError(context, e.message);
    } catch (_) {
      if (context.mounted) {
        showSettingsError(context, 'Не удалось сменить пароль.');
      }
    }
  }
}

/// The values collected by [_ChangePasswordDialog].
class _ChangePasswordResult {
  const _ChangePasswordResult(this.currentPassword, this.newPassword);

  final String currentPassword;
  final String newPassword;
}

/// Change-password dialog: current + new password (with the shared strength
/// rules), validated client-side before the server round-trip.
class _ChangePasswordDialog extends StatefulWidget {
  const _ChangePasswordDialog();

  @override
  State<_ChangePasswordDialog> createState() => _ChangePasswordDialogState();
}

class _ChangePasswordDialogState extends State<_ChangePasswordDialog> {
  final _formKey = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _next = TextEditingController();
  bool _obscureCurrent = true;
  bool _obscureNext = true;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    super.dispose();
  }

  void _submit() {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    Navigator.of(context).pop(
      _ChangePasswordResult(_current.text, _next.text),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Сменить пароль'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextFormField(
              controller: _current,
              obscureText: _obscureCurrent,
              autofocus: true,
              autocorrect: false,
              enableSuggestions: false,
              autofillHints: const [AutofillHints.password],
              decoration: InputDecoration(
                labelText: 'Текущий пароль',
                prefixIcon: const Icon(Icons.lock_outline_rounded),
                suffixIcon: IconButton(
                  tooltip: _obscureCurrent ? 'Показать' : 'Скрыть',
                  onPressed: () =>
                      setState(() => _obscureCurrent = !_obscureCurrent),
                  icon: Icon(_obscureCurrent
                      ? Icons.visibility_outlined
                      : Icons.visibility_off_outlined),
                ),
              ),
              validator: AuthValidators.loginPassword,
            ),
            const SizedBox(height: AppSpacing.md),
            TextFormField(
              controller: _next,
              obscureText: _obscureNext,
              autocorrect: false,
              enableSuggestions: false,
              autofillHints: const [AutofillHints.newPassword],
              decoration: InputDecoration(
                labelText: 'Новый пароль',
                helperText: 'Минимум 8 символов',
                prefixIcon: const Icon(Icons.lock_reset_rounded),
                suffixIcon: IconButton(
                  tooltip: _obscureNext ? 'Показать' : 'Скрыть',
                  onPressed: () => setState(() => _obscureNext = !_obscureNext),
                  icon: Icon(_obscureNext
                      ? Icons.visibility_outlined
                      : Icons.visibility_off_outlined),
                ),
              ),
              validator: (v) {
                final base = AuthValidators.newPassword(v);
                if (base != null) return base;
                if (v == _current.text) {
                  return 'Новый пароль должен отличаться';
                }
                return null;
              },
              onFieldSubmitted: (_) => _submit(),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Отмена'),
        ),
        FilledButton(onPressed: _submit, child: const Text('Сменить пароль')),
      ],
    );
  }
}
