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

/// `/forgot-password` — request a password-reset email.
///
/// Mirrors the web `ForgotPasswordForm`. ANTI-ENUMERATION: on ANY settled
/// request (the API 204s regardless) we swap to the same neutral confirmation
/// ("if such an email exists, we've sent a link"), so the screen never reveals
/// whether the address is registered.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();
    await ref
        .read(forgotPasswordControllerProvider.notifier)
        .request(_emailController.text);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;
    final state = ref.watch(forgotPasswordControllerProvider);

    return AuthShell(
      tagline: 'Вернём доступ к эфиру',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          GlassCard(
            padding: const EdgeInsets.all(AppSpacing.xl),
            glowColor: colors.neonCyan,
            glowStrength: 0.4,
            intensity: 1.1,
            child: state.isSuccess
                ? _SentConfirmation(
                    onResend: () => ref
                        .read(forgotPasswordControllerProvider.notifier)
                        .reset(),
                  )
                : Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          'ВОССТАНОВЛЕНИЕ',
                          style: AppTypography.eyebrow(color: colors.neonCyan),
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        Text('Забыли пароль?',
                            style: context.texts.headlineSmall),
                        const SizedBox(height: AppSpacing.xs),
                        Text(
                          'Введите email — пришлём ссылку для сброса пароля.',
                          style: context.texts.bodyMedium
                              ?.copyWith(color: scheme.onSurfaceVariant),
                        ),
                        const SizedBox(height: AppSpacing.xl),
                        AuthTextField(
                          controller: _emailController,
                          label: 'Email',
                          hint: 'you@example.com',
                          prefixIcon: Icons.alternate_email_rounded,
                          keyboardType: TextInputType.emailAddress,
                          autofillHints: const [AutofillHints.email],
                          textInputAction: TextInputAction.done,
                          autofocus: true,
                          validator: AuthValidators.email,
                        ),
                        const SizedBox(height: AppSpacing.xl),
                        GradientButton(
                          label: 'Отправить ссылку',
                          icon: Icons.send_rounded,
                          loading: state.isBusy,
                          onPressed: _submit,
                        ),
                      ],
                    ),
                  ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Center(
            child: TextButton.icon(
              onPressed: () => context.go(AppRoutes.login),
              icon: const Icon(Icons.arrow_back_rounded, size: 18),
              label: const Text('Вернуться ко входу'),
              style: TextButton.styleFrom(
                foregroundColor: context.scheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The neutral "we sent a link" confirmation shown after a request settles.
class _SentConfirmation extends StatelessWidget {
  const _SentConfirmation({required this.onResend});

  final VoidCallback onResend;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            borderRadius: AppRadii.brMd,
            color: colors.neonCyan.withValues(alpha: 0.12),
          ),
          child: Icon(Icons.mark_email_read_outlined, color: colors.neonCyan),
        ),
        const SizedBox(height: AppSpacing.lg),
        Text('Проверьте почту', style: context.texts.headlineSmall),
        const SizedBox(height: AppSpacing.sm),
        Text(
          'Если такой аккаунт существует, мы отправили ссылку для сброса '
          'пароля. Ссылка действует ограниченное время.',
          style: context.texts.bodyMedium
              ?.copyWith(color: scheme.onSurfaceVariant, height: 1.4),
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(
          'Не пришло? Загляните в «Спам».',
          style: context.texts.bodySmall
              ?.copyWith(color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: AppSpacing.lg),
        OutlinedButton.icon(
          onPressed: onResend,
          icon: const Icon(Icons.refresh_rounded, size: 18),
          label: const Text('Отправить снова'),
        ),
      ],
    );
  }
}
