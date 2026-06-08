import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/routes.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../domain/auth_email_controller.dart';
import '../domain/auth_validators.dart';
import 'widgets/auth_form_fields.dart';
import 'widgets/auth_shell.dart';

/// `/reset-password?token=…` — set a new password from the emailed link.
///
/// Mirrors the web `ResetPasswordForm`: a missing/blank token shows a "link
/// mangled" state, a server-rejected token shows an "expired" state, and on
/// success it routes back to `/login` (the server revokes all sessions, so the
/// user re-authenticates with the new password).
class ResetPasswordScreen extends ConsumerStatefulWidget {
  const ResetPasswordScreen({super.key, required this.token});

  /// The single-use reset token from the `token` query parameter.
  final String token;

  @override
  ConsumerState<ResetPasswordScreen> createState() =>
      _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends ConsumerState<ResetPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _passwordController = TextEditingController();

  @override
  void dispose() {
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();
    final ok = await ref.read(resetPasswordControllerProvider.notifier).submit(
          token: widget.token,
          password: _passwordController.text,
        );
    if (ok && mounted) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(
          content: Text('Пароль изменён. Войдите с новым паролем.'),
        ));
      context.go(AppRoutes.login);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;
    final state = ref.watch(resetPasswordControllerProvider);
    final token = widget.token.trim();

    // A missing/blank token means the link was mangled or visited directly.
    if (token.isEmpty) {
      return _ResetMessage(
        title: 'Ссылка недействительна',
        body: 'Ссылка повреждена или открыта напрямую. Запросите новую.',
        actionLabel: 'Запросить новую ссылку',
        onAction: () => context.go(AppRoutes.forgotPassword),
      );
    }

    return AuthShell(
      tagline: 'Новый пароль — за пару секунд',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          GlassCard(
            padding: const EdgeInsets.all(AppSpacing.xl),
            glowColor: colors.neonViolet,
            glowStrength: 0.4,
            intensity: 1.1,
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('НОВЫЙ ПАРОЛЬ',
                      style: AppTypography.eyebrow(color: colors.neonViolet)),
                  const SizedBox(height: AppSpacing.sm),
                  Text('Сброс пароля', style: context.texts.headlineSmall),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    'Придумайте новый пароль для входа.',
                    style: context.texts.bodyMedium
                        ?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  PasswordField(
                    controller: _passwordController,
                    label: 'Новый пароль',
                    hint: 'Минимум 8 символов',
                    showStrength: true,
                    autofillHints: const [AutofillHints.newPassword],
                    textInputAction: TextInputAction.done,
                    validator: AuthValidators.newPassword,
                    onSubmitted: _submit,
                  ),
                  if (state.isError) ...[
                    const SizedBox(height: AppSpacing.md),
                    AuthErrorBanner(
                      message: state.error ??
                          'Ссылка недействительна или устарела.',
                    ),
                  ],
                  const SizedBox(height: AppSpacing.xl),
                  GradientButton(
                    label: 'Сохранить пароль',
                    icon: Icons.lock_reset_rounded,
                    gradientColors: [colors.neonViolet, colors.neonMagenta],
                    loading: state.isBusy,
                    onPressed: _submit,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Center(
            child: TextButton(
              onPressed: () => context.go(AppRoutes.login),
              child: const Text('Вернуться ко входу'),
            ),
          ),
        ],
      ),
    );
  }
}

/// A full-screen message state (missing-token) with a single primary action.
class _ResetMessage extends StatelessWidget {
  const _ResetMessage({
    required this.title,
    required this.body,
    required this.actionLabel,
    required this.onAction,
  });

  final String title;
  final String body;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;
    return AuthShell(
      tagline: 'Вернём доступ к эфиру',
      child: GlassCard(
        padding: const EdgeInsets.all(AppSpacing.xl),
        glowColor: colors.warning,
        glowStrength: 0.35,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                borderRadius: AppRadii.brMd,
                color: colors.warning.withValues(alpha: 0.12),
              ),
              child: Icon(Icons.warning_amber_rounded, color: colors.warning),
            ),
            const SizedBox(height: AppSpacing.lg),
            Text(title, style: context.texts.headlineSmall),
            const SizedBox(height: AppSpacing.sm),
            Text(
              body,
              style: context.texts.bodyMedium
                  ?.copyWith(color: scheme.onSurfaceVariant, height: 1.4),
            ),
            const SizedBox(height: AppSpacing.xl),
            GradientButton(
              label: actionLabel,
              icon: Icons.refresh_rounded,
              onPressed: onAction,
            ),
          ],
        ),
      ),
    );
  }
}
